import { sql, type SQL } from 'drizzle-orm';

/**
 * Normalizes an email address:
 * - Trims leading/trailing whitespace
 * - Converts to lowercase
 * - For Gmail/Googlemail domains, normalizes googlemail.com to gmail.com
 *   and strips dots from the local part.
 */
export function normalizeEmail(email: string): string {
    if (!email) return '';
    const trimmed = email.trim().toLowerCase();
    const atIndex = trimmed.indexOf('@');
    if (atIndex === -1) return trimmed;

    let localPart = trimmed.substring(0, atIndex);
    let domain = trimmed.substring(atIndex + 1);

    if (domain === 'googlemail.com') {
        domain = 'gmail.com';
    }

    if (domain === 'gmail.com') {
        localPart = localPart.replace(/\./g, '');
    }

    return `${localPart}@${domain}`;
}

/**
 * Returns true if the email is a Google/Gmail address where dots are ignored.
 */
export function isGmailAddress(email: string): boolean {
    if (!email) return false;
    const lower = email.trim().toLowerCase();
    const atIndex = lower.indexOf('@');
    if (atIndex === -1) return false;
    const domain = lower.substring(atIndex + 1);
    return domain === 'gmail.com' || domain === 'googlemail.com';
}

/**
 * Builds a SQL expression for Drizzle ORM that matches an email column against
 * an input email, treating Gmail addresses as dot-insensitive.
 *
 * For example, if users.email is 'dasamantarao.aditya@gmail.com', matching against
 * 'dasamantaraoaditya@gmail.com' (and vice versa) returns true in PostgreSQL.
 */
export function emailMatchSql(column: any, inputEmail: string): SQL {
    const normalized = inputEmail.trim().toLowerCase();
    const atIndex = normalized.indexOf('@');

    if (atIndex === -1) {
        return sql`LOWER(${column}) = ${normalized}`;
    }

    const localPart = normalized.substring(0, atIndex);
    const domain = normalized.substring(atIndex + 1);

    if (domain === 'gmail.com' || domain === 'googlemail.com') {
        const cleanLocal = localPart.replace(/\./g, '');
        return sql`(
            LOWER(${column}) = ${normalized}
            OR (
                (LOWER(${column}) LIKE '%@gmail.com' OR LOWER(${column}) LIKE '%@googlemail.com')
                AND REPLACE(SPLIT_PART(LOWER(${column}), '@', 1), '.', '') = ${cleanLocal}
            )
        )`;
    }

    return sql`LOWER(${column}) = ${normalized}`;
}
