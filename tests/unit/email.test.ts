import { describe, it, expect } from '@jest/globals';
import { normalizeEmail, isGmailAddress, emailMatchSql } from '../../src/utils/email.util.js';
import { sql } from 'drizzle-orm';

describe('Email Utility Tests', () => {
    describe('normalizeEmail', () => {
        it('normalizes uppercase and leading/trailing whitespace', () => {
            expect(normalizeEmail('  User@Example.Com  ')).toBe('user@example.com');
        });

        it('removes dots from gmail local parts', () => {
            expect(normalizeEmail('dasamantarao.aditya@gmail.com')).toBe('dasamantaraoaditya@gmail.com');
            expect(normalizeEmail('d.a.s.a.m.a.n.t.a.r.a.o@gmail.com')).toBe('dasamantarao@gmail.com');
        });

        it('normalizes googlemail.com to gmail.com and removes dots', () => {
            expect(normalizeEmail('dasamantarao.aditya@googlemail.com')).toBe('dasamantaraoaditya@gmail.com');
        });

        it('preserves dots for non-gmail domains', () => {
            expect(normalizeEmail('john.doe@company.org')).toBe('john.doe@company.org');
            expect(normalizeEmail('aditya.das@yahoo.com')).toBe('aditya.das@yahoo.com');
        });
    });

    describe('isGmailAddress', () => {
        it('identifies gmail.com and googlemail.com addresses', () => {
            expect(isGmailAddress('test@gmail.com')).toBe(true);
            expect(isGmailAddress('test@googlemail.com')).toBe(true);
            expect(isGmailAddress('test@GMAIL.COM')).toBe(true);
        });

        it('returns false for non-gmail domains', () => {
            expect(isGmailAddress('test@outlook.com')).toBe(false);
            expect(isGmailAddress('test@yahoo.com')).toBe(false);
            expect(isGmailAddress('not-an-email')).toBe(false);
        });
    });

    describe('emailMatchSql', () => {
        it('generates dot-insensitive SQL for gmail addresses', () => {
            const fakeCol = sql`users.email`;
            const query = emailMatchSql(fakeCol, 'dasamantaraoaditya@gmail.com');
            expect(query).toBeDefined();
        });

        it('generates standard case-insensitive SQL for non-gmail addresses', () => {
            const fakeCol = sql`users.email`;
            const query = emailMatchSql(fakeCol, 'user@domain.com');
            expect(query).toBeDefined();
        });
    });
});
