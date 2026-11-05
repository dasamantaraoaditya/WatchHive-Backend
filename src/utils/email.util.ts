import { sql, type SQL } from 'drizzle-orm';

/**
 * Regex matching invisible Unicode characters, zero-width spaces, BOM,
 * non-breaking spaces, directional formatting marks, and control characters.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE_AND_WHITESPACE_REGEX = /[\u0000-\u001F\u007F\u00A0\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/g;

/**
 * Domains known to support RFC subaddressing (+tags) routing to the same mailbox.
 */
const SUBADDRESS_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'protonmail.com',
    'proton.me',
    'pm.me',
    'fastmail.com',
]);

/**
 * Robustly sanitizes an email string:
 * - Removes invisible Unicode characters, zero-width spaces, and control characters
 * - Trims leading and trailing whitespace
 * - Converts to lower case
 */
export function cleanEmail(email?: string | null): string {
    if (!email || typeof email !== 'string') return '';
    return email
        .replace(INVISIBLE_AND_WHITESPACE_REGEX, '')
        .trim()
        .toLowerCase();
}

/**
 * Backwards-compatible alias for cleanEmail.
 */
export function normalizeEmail(email: string): string {
    return cleanEmail(email);
}

/**
 * Returns true if the email is a Google/Gmail address where dots and +tags are ignored.
 */
export function isGmailAddress(email: string): boolean {
    if (!email) return false;
    const lower = cleanEmail(email);
    const atIndex = lower.indexOf('@');
    if (atIndex === -1) return false;
    const domain = lower.substring(atIndex + 1);
    return domain === 'gmail.com' || domain === 'googlemail.com';
}

/**
 * Extracts the canonical routing address:
 * - Normalizes googlemail.com to gmail.com
 * - Strips dots and +tag subaddresses for Gmail / Googlemail
 * - Strips +tag subaddresses for major providers (Outlook, iCloud, Proton)
 * - Returns clean lowercased email for custom/corporate domains
 */
export function getCanonicalEmail(email: string): string {
    const cleaned = cleanEmail(email);
    const atIndex = cleaned.indexOf('@');
    if (atIndex === -1) return cleaned;

    let localPart = cleaned.substring(0, atIndex);
    let domain = cleaned.substring(atIndex + 1);

    if (domain === 'googlemail.com') {
        domain = 'gmail.com';
    }

    if (domain === 'gmail.com') {
        // In Gmail, both dots and +tags are ignored
        localPart = localPart.split('+')[0].replace(/\./g, '');
        return `${localPart}@${domain}`;
    }

    if (SUBADDRESS_DOMAINS.has(domain)) {
        // Provider ignores +tags for mailbox routing
        localPart = localPart.split('+')[0];
        return `${localPart}@${domain}`;
    }

    return `${localPart}@${domain}`;
}

/**
 * Builds a SQL expression for Drizzle ORM that matches an email column against
 * an input email, treating:
 * 1. All emails as case-insensitive and whitespace/invisible-character-cleaned
 * 2. Gmail / Googlemail as dot-insensitive and subaddress (+tag)-insensitive
 * 3. Outlook / iCloud / ProtonMail / Fastmail as subaddress (+tag)-insensitive
 *
 * For example:
 * - 'dasamantarao.aditya@gmail.com' matches 'dasamantaraoaditya@gmail.com'
 * - 'dasamantaraoaditya+test@gmail.com' matches 'dasamantarao.aditya@gmail.com'
 * - 'user+anything@outlook.com' matches 'user@outlook.com'
 */
export function emailMatchSql(column: any, inputEmail: string): SQL {
    const cleaned = cleanEmail(inputEmail);
    const atIndex = cleaned.indexOf('@');

    if (atIndex === -1) {
        return sql`LOWER(${column}) = ${cleaned}`;
    }

    const localPart = cleaned.substring(0, atIndex);
    const domain = cleaned.substring(atIndex + 1);

    if (domain === 'gmail.com' || domain === 'googlemail.com') {
        const cleanGmailLocal = localPart.split('+')[0].replace(/\./g, '');
        return sql`(
            LOWER(${column}) = ${cleaned}
            OR (
                (LOWER(${column}) LIKE '%@gmail.com' OR LOWER(${column}) LIKE '%@googlemail.com')
                AND REPLACE(SPLIT_PART(SPLIT_PART(LOWER(${column}), '@', 1), '+', 1), '.', '') = ${cleanGmailLocal}
            )
        )`;
    }

    if (SUBADDRESS_DOMAINS.has(domain)) {
        const cleanSubLocal = localPart.split('+')[0];
        return sql`(
            LOWER(${column}) = ${cleaned}
            OR (
                SPLIT_PART(LOWER(${column}), '@', 2) = ${domain}
                AND SPLIT_PART(SPLIT_PART(LOWER(${column}), '@', 1), '+', 1) = ${cleanSubLocal}
            )
        )`;
    }

    return sql`LOWER(${column}) = ${cleaned}`;
}
