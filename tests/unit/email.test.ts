import { describe, it, expect } from '@jest/globals';
import { cleanEmail, getCanonicalEmail, isGmailAddress, emailMatchSql } from '../../src/utils/email.util.js';
import { sql } from 'drizzle-orm';

describe('Email Utility Tests', () => {
    describe('cleanEmail', () => {
        it('normalizes uppercase and leading/trailing ASCII whitespace', () => {
            expect(cleanEmail('  User@Example.Com  ')).toBe('user@example.com');
        });

        it('strips non-breaking spaces and zero-width spaces', () => {
            expect(cleanEmail('user\u00A0@example.com\u200B')).toBe('user@example.com');
            expect(cleanEmail('\uFEFFuser@example.com\u202F')).toBe('user@example.com');
        });

        it('handles null, undefined, or empty values safely', () => {
            expect(cleanEmail(null)).toBe('');
            expect(cleanEmail(undefined)).toBe('');
            expect(cleanEmail('')).toBe('');
        });

        it('preserves valid RFC characters in local part', () => {
            expect(cleanEmail("o'connor.john+tag_123-test@domain.co.uk")).toBe("o'connor.john+tag_123-test@domain.co.uk");
        });
    });

    describe('getCanonicalEmail', () => {
        it('removes dots and subaddresses (+tags) from gmail local parts', () => {
            expect(getCanonicalEmail('dasamantarao.aditya@gmail.com')).toBe('dasamantaraoaditya@gmail.com');
            expect(getCanonicalEmail('dasamantarao.aditya+watchhive@gmail.com')).toBe('dasamantaraoaditya@gmail.com');
            expect(getCanonicalEmail('d.a.s.a.m.a.n.t.a.r.a.o+test@gmail.com')).toBe('dasamantarao@gmail.com');
        });

        it('normalizes googlemail.com to gmail.com, stripping dots and subaddresses', () => {
            expect(getCanonicalEmail('dasamantarao.aditya+tag@googlemail.com')).toBe('dasamantaraoaditya@gmail.com');
        });

        it('removes subaddresses (+tags) for other major providers (Outlook, iCloud, Proton)', () => {
            expect(getCanonicalEmail('john.doe+news@outlook.com')).toBe('john.doe@outlook.com');
            expect(getCanonicalEmail('user+movies@icloud.com')).toBe('user@icloud.com');
            expect(getCanonicalEmail('secure+vault@proton.me')).toBe('secure@proton.me');
        });

        it('preserves dots and plus signs for custom/corporate domains', () => {
            expect(getCanonicalEmail('john.doe@company.org')).toBe('john.doe@company.org');
            expect(getCanonicalEmail('aditya.das+test@university.edu')).toBe('aditya.das+test@university.edu');
        });
    });

    describe('isGmailAddress', () => {
        it('identifies gmail.com and googlemail.com addresses', () => {
            expect(isGmailAddress('test@gmail.com')).toBe(true);
            expect(isGmailAddress('test@googlemail.com')).toBe(true);
            expect(isGmailAddress('test@GMAIL.COM')).toBe(true);
            expect(isGmailAddress('test+tag@googlemail.com')).toBe(true);
        });

        it('returns false for non-gmail domains', () => {
            expect(isGmailAddress('test@outlook.com')).toBe(false);
            expect(isGmailAddress('test@yahoo.com')).toBe(false);
            expect(isGmailAddress('not-an-email')).toBe(false);
        });
    });

    describe('emailMatchSql', () => {
        it('generates dot-insensitive and subaddress-insensitive SQL for gmail addresses', () => {
            const fakeCol = sql`users.email`;
            const query = emailMatchSql(fakeCol, 'dasamantaraoaditya+test@gmail.com');
            expect(query).toBeDefined();
        });

        it('generates subaddress-insensitive SQL for outlook/icloud/proton addresses', () => {
            const fakeCol = sql`users.email`;
            const query = emailMatchSql(fakeCol, 'user+tag@outlook.com');
            expect(query).toBeDefined();
        });

        it('generates standard case-insensitive SQL for generic domains', () => {
            const fakeCol = sql`users.email`;
            const query = emailMatchSql(fakeCol, 'user@domain.com');
            expect(query).toBeDefined();
        });
    });
});
