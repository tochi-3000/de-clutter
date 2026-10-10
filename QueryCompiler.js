/**
 * Declutter: Production Implementation
 * File: QueryCompiler.js
 * Description: Tokenized AST query compiler & injection sanitizer for Gmail search DSL.
 */

// eslint-disable-next-line no-var
var QueryCompiler = (function () {
  /**
   * Sanitizes a sender pattern (email or @domain).
   * Strips control characters, spaces, and colons.
   * @param {string} sender
   * @returns {{ valid: boolean, sanitized: string, error?: string }}
   */
  function sanitizeSender(sender) {
    if (!sender || typeof sender !== 'string') {
      return { valid: false, sanitized: '', error: 'Sender pattern cannot be empty.' };
    }

    // Strip whitespace, colons, brackets, and control chars
    const cleaned = sender.trim().replace(/[\s:()<>{}"'\r\n]/g, '');
    if (!cleaned) {
      return { valid: false, sanitized: '', error: 'Sender pattern is empty after sanitization.' };
    }

    // Must match either a domain (@domain.com or domain.com) or an email address (user@domain.com)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const domainRegex = /^@?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!emailRegex.test(cleaned) && !domainRegex.test(cleaned)) {
      return { valid: false, sanitized: '', error: 'Invalid sender format. Must be an email (user@domain.com) or domain (@domain.com).' };
    }

    return { valid: true, sanitized: cleaned };
  }

  /**
   * Tokenizes and sanitizes keywords, preserving quoted phrases while neutralizing operator injections.
   * @param {string} keywords
   * @returns {{ valid: boolean, clause: string, error?: string }}
   */
  function compileKeywords(keywords) {
    if (!keywords || typeof keywords !== 'string') {
      return { valid: true, clause: '' }; // Keywords are optional
    }

    const trimmed = keywords.trim();
    if (!trimmed) {
      return { valid: true, clause: '' };
    }

    // Disallow carriage returns, newlines, curly brackets
    const stripped = trimmed.replace(/[\r\n{}]/g, ' ');

    // Extract quoted phrases ("...") and unquoted segments
    const phraseRegex = /"([^"]+)"|'([^']+)'|([^"'\s,]+)/g;
    const tokens = [];
    let match;

    while ((match = phraseRegex.exec(stripped)) !== null) {
      if (match[1]) {
        // Double-quoted phrase
        const cleanPhrase = match[1].replace(/[:()<>{}"'\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanPhrase) {
          tokens.push(`"${cleanPhrase}"`);
        }
      } else if (match[2]) {
        // Single-quoted phrase
        const cleanPhrase = match[2].replace(/[:()<>{}"'\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanPhrase) {
          tokens.push(`"${cleanPhrase}"`);
        }
      } else if (match[3]) {
        // Unquoted token
        const rawToken = match[3].trim();
        if (rawToken.toUpperCase() === 'OR') {
          // Keep explicit OR operator
          if (tokens.length > 0 && tokens[tokens.length - 1] !== 'OR') {
            tokens.push('OR');
          }
        } else {
          // Strip colons, parentheses, operators from unquoted word
          const cleanWord = rawToken.replace(/[:()<>{}"']/g, '').trim();
          if (cleanWord && cleanWord.toUpperCase() !== 'OR') {
            tokens.push(cleanWord);
          }
        }
      }
    }

    // Clean up trailing or leading 'OR'
    if (tokens.length > 0 && tokens[tokens.length - 1] === 'OR') {
      tokens.pop();
    }
    if (tokens.length > 0 && tokens[0] === 'OR') {
      tokens.shift();
    }

    if (tokens.length === 0) {
      return { valid: true, clause: '' };
    }

    return { valid: true, clause: `(${tokens.join(' ')})` };
  }

  /**
   * Compiles a complete Gmail search query from rule parameters.
   * @param {Object} rule
   * @param {string} rule.SenderPattern
   * @param {string} [rule.Keywords]
   * @param {number|string} rule.RetentionDays
   * @param {boolean} [rule.ProtectStarred=true]
   * @returns {{ query: string|null, error: string|null }}
   */
  function compileRule(rule) {
    if (!rule || typeof rule !== 'object') {
      return { query: null, error: 'Rule definition must be an object.' };
    }

    // 1. Sanitize Sender
    const senderRes = sanitizeSender(rule.SenderPattern);
    if (!senderRes.valid) {
      return { query: null, error: senderRes.error || 'Invalid sender pattern.' };
    }

    // 2. Parse Keywords
    const keywordRes = compileKeywords(rule.Keywords);
    if (!keywordRes.valid) {
      return { query: null, error: keywordRes.error || 'Invalid keyword pattern.' };
    }

    // 3. Validate Retention Days
    const retentionDays = parseInt(rule.RetentionDays, 10);
    if (isNaN(retentionDays) || retentionDays < 1) {
      return { query: null, error: 'Retention days must be an integer greater than or equal to 1.' };
    }

    // 4. Build Safety Clauses
    const parts = [];
    parts.push(`from:(${senderRes.sanitized})`);

    if (keywordRes.clause) {
      parts.push(keywordRes.clause);
    }

    // Retention boundary
    parts.push(`older_than:${retentionDays}d`);

    // Mandatory safety exclusions
    parts.push('-in:trash');
    parts.push('-in:spam');
    parts.push('-label:Declutter-Exempt');

    // Starred protection
    if (rule.ProtectStarred !== false && rule.ProtectStarred !== 'FALSE') {
      parts.push('-is:starred');
    }

    const compiledQuery = parts.join(' ');
    return { query: compiledQuery, error: null };
  }

  return {
    sanitizeSender: sanitizeSender,
    compileKeywords: compileKeywords,
    compileRule: compileRule
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QueryCompiler;
}
