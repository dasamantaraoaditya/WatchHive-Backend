# Contributing to WatchHive Backend

Thank you for your interest in contributing to WatchHive!

## API Documentation Routine

To maintain a high standard of documentation, all new API routes **MUST** be documented using Swagger JSDoc.

### How to document a new route:

1.  Use the `@openapi` tag in your route files.
2.  Specify the `tags`, `summary`, and `security` (use `bearerAuth` for protected routes).
3.  Define all `parameters` (path, query, body).
4.  Provide clear `responses` for success (2xx) and common error cases (4xx, 5xx).

Example:

```typescript
/**
 * @openapi
 * /api/v1/example:
 *   get:
 *     tags: [Example]
 *     summary: Example endpoint
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/example', authMiddleware, (req, res) => {
    res.json({ message: 'Example' });
});
```

### Verification:

Before submitting a Pull Request, please:
1.  Run the application locally (`npm run dev`).
2.  Navigate to `http://localhost:5001/api/docs`.
3.  Verify that your new endpoint appears and is correctly documented.
