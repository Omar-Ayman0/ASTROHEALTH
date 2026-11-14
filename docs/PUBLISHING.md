# Publish to GitHub

Extract ZIP, enter repository root, review license and asset rights, run tests and configure local secrets.

```bash
git init
git branch -M main
git add .
git status
git diff --cached --stat
git commit -m "Prepare ASTROHEALTH research prototype"
git remote add origin https://github.com/YOUR-ACCOUNT/ASTROHEALTH.git
git push -u origin main
git tag v0.1.0-demo
git push origin v0.1.0-demo
```

Create an empty GitHub repository first. No push was performed. Description: Personalized astronaut health intelligence with a custom physiological monitoring engine, event-driven n8n automation, evidence-grounded AI assistance, and human-led medical review. Topics: nasa-space-apps, astronaut-health, health-monitoring, ai-automation, n8n, fastapi, react, nodejs, anomaly-detection, offline-first, human-in-the-loop, synthetic-data. Check secrets, dependency installation, runtime demo, screenshots and team attribution before public release.

Final repository name: `ASTROHEALTH`. The supplied 56-second MP4 is included; a hosted URL is optional but recommended for convenient playback. See [publication checklist](PUBLICATION_CHECKLIST.md) and [final verification](FINAL_VERIFICATION.md). The package is presentation-ready, not full-stack validated.
