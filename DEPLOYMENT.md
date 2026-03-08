# 🚀 Deployment & CI/CD Guide

This project follows a professional **"Ship on Push"** workflow.

## 🏗️ Architecture
1. **Push**: You push code to GitHub.
2. **CI (GitHub Actions)**: Automated tests and linting run immediately.
3. **CD (Railway)**: If tests pass, Railway automatically builds and deploys the new version.

---

## 🛠️ How to Ship New Features

### 1. Simple Push
Just push your changes to the `main` branch.
```bash
git add .
git commit -m "feat: your feature"
git push origin main
```

### 2. Automatic Checks
- Check the **Actions** tab on GitHub to see the progress of tests.
- If a test fails, the deployment to Railway will be blocked to protect your production site.

### 3. Live on Railway
- Once tests pass (green checkmark), Railway starts the deployment.
- Check your [Railway Dashboard](https://railway.app/) for the live status.

---

## 📋 Manual Deployment
If you ever need to deploy manually from your terminal:
```bash
railway up
```

## 🧪 Running Tests Locally
Before pushing, it's good practice to run tests locally:
```bash
npm run lint    # Check for code style
npm test        # Run automated tests
```

> [!NOTE]
> Local tests might show SSL errors when connecting to the production database. This is a safety feature. The GitHub CI environment handles this automatically for you.
