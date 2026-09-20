JCI NURSING TRACER — TABLET PWA v0.3

UPLOAD THIS FOLDER'S CONTENTS TO YOUR GITHUB PAGES SITE.
Do NOT upload the Master DB JSON to the public website unless you intentionally want the question bank public.

Recommended folder on your existing GitHub Pages repository:
jci-tracer/

Files to upload inside jci-tracer/:
- index.html
- app.js
- style.css
- manifest.webmanifest
- service-worker.js
- .nojekyll
- icons/

After GitHub Pages deploys:
1. Open the /jci-tracer/ URL in Safari on the iPad.
2. Share -> Add to Home Screen -> Add.
3. Open the new JCI Tracer icon.
4. Save the separately supplied JCI_Nursing_Tracer_Master_DB_CONTENT_FROZEN_v1.json in the iPad Files app.
5. In the app, tap Import Master Database and select that JSON file.
6. Start testing.

DATA:
- Question database: imported and stored locally on the iPad.
- Staff history / review decisions / sessions: stored locally on the iPad in IndexedDB.
- GitHub Pages only hosts the app shell.
- No Firebase required.
- Export Backup regularly.
