# Setting up the app for a new summer

One leader does this once, about 30 minutes. You need a Google account and this GitHub repo.

## 1. Pick the Google account that will own everything

Use the **club's regular Google account** (an `@gmail.com` address the leaders share), not a personal or `@illinois.edu` account:

- University Workspace accounts often block apps that "Anyone" can reach and block "anyone with the link" sharing. The app needs both.
- When leadership changes, the account and all the summer's files stay with the club.
- Storage: the free 15 GB fills up with a summer of video. A 100 GB Google One plan is a few dollars a month. You can also point the folders at an existing shared drive (see step 4).

## 2. Create the master sheet and paste in the backend

1. Signed in as the club account, create a new Google Sheet, e.g. **Illini 4000 2027 – Master**.
2. **Extensions → Apps Script**. A code editor opens.
3. Delete everything in `Code.gs` and paste the whole of [`backend/Code.gs`](../backend/Code.gs). Click **Save** (disk icon).
4. Recommended: click the **gear (Project Settings)**, tick **Show "appsscript.json" manifest file in editor**, go back to the editor, open `appsscript.json` and replace it with [`backend/appsscript.json`](../backend/appsscript.json). Change `"timeZone"` if you want reminders in another time zone. Save.

## 3. Run setup

1. In the toolbar's function menu pick **setup**, then **Run**.
2. Google asks for permission. Click **Review permissions** → choose the club account → **Advanced** → **Go to … (unsafe)** → **Allow**. ("Unsafe" only means Google hasn't reviewed your own script.)
3. Go back to the sheet. A box shows the **team code** and the **app files folder**. Setup has:
   - created the tabs (Config, Riders, Itinerary, Stayovers, Duties, and one tab per log),
   - created the Drive folders: *Photos & Videos (by day)*, *Receipts*, *Donations*, *Portrait Interviews*, *Reports & Accidents*,
   - scheduled the morning reminder (6 am by default, `Reminder Hour` in Config).
4. Reload the sheet. An **Illini 4000** menu appears with *Set up / repair*, *Refresh mileage from RideWithGPS*, *Send today's reminders now* and *Fill with sample data*.

Want to try it first? Use *Fill with sample data* on a copy of the sheet.

## 4. Optional: save files somewhere else

In the **Config** tab, the `… Folder ID` rows say where files go. To use an existing folder or shared drive, open it in Drive, copy the ID from the address bar (the part after `/folders/`) and paste it in. Receipts and donations can live in entirely separate drives, e.g. one the treasurer owns. The club account needs edit access to those folders.

## 5. Publish the backend

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Description: `Ride app`. **Execute as: Me**. **Who has access: Anyone**.
4. **Deploy**, then copy the **Web app URL** (ends in `/exec`).

> **Changing `Code.gs` later?** Use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. That keeps the same URL. "New deployment" would create a new URL and the phones would keep using the old one.

## 6. Point the app at it and publish the app

1. In this GitHub repo open [`public/config.json`](../public/config.json), click the pencil, and paste the URL:
   ```json
   { "apiUrl": "https://script.google.com/macros/s/AKfy…/exec", "teamName": "Illini 4000" }
   ```
   Commit to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The **Actions** tab shows "Deploy app to GitHub Pages" running. When it's green the app is live at
   `https://<your-github-name>.github.io/illini4000-ride-app/`
4. Put that link in the sheet's **Config → App URL** row, so reminder emails link to the app.

## 7. Fill the sheet

See **[SHEET-GUIDE.md](SHEET-GUIDE.md)**. At minimum: everyone in **Riders**, the days in **Itinerary**, and the hosts in **Stayovers**.

## 8. Kick-off

1. Leaders sign in first (the first PIN typed for a name becomes that person's PIN, so claim yours before sharing the link).
2. Send everyone the app link, the team code and **[INSTALL-ON-PHONE.md](INSTALL-ON-PHONE.md)**. Have people install and sign in together at a meeting.
3. If someone forgets their PIN, clear their **PIN Hash** cell in Riders. To give someone a starting PIN, type it (4–8 digits) into that cell; it is replaced by a scrambled version when they sign in.
4. To sign every phone out (a phone was lost, the code leaked), change **Team Code** in Config.

## Who can see what

- Everything goes into the master sheet and Drive folders owned by the club account. Whoever can open the sheet can read all of it, including "Just me" journal entries.
- "This phone only" journal entries never leave the phone.
- Photos and videos are shared "anyone with the link" so the app can show thumbnails (turn off with `Share Photos With Link = FALSE`; the gallery then shows file names). Receipts, donations, interviews and reports are never shared.
- Riders can edit and delete only what they added. Leaders and the route master (Role column) can edit anything, change routes and add jobs.

## Free limits to know about

With a regular Google account Apps Script allows, per day: 100 email recipients, 20,000 outside calls (RideWithGPS, ntfy, Drive uploads in pieces), and 30 requests at the same moment. Reminders go only to riders with jobs that day, so a 30-person team stays well under. If emails run short, have people use ntfy notifications instead (see the install guide). Limits: [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

## Each new year

1. In last year's sheet: **File → Make a copy**. The script comes along.
2. In the copy, clear the log tabs (Checkins, Journals, Reports, Gas, Expenses, Donations, Interviews, Media, DriverSwaps), clear **PIN Hash**, update Riders/Itinerary/Stayovers, and blank out the `… Folder ID` rows and Team Code in Config.
3. Copy last year's **Route comment** reports into each day's **Notes From Previous Riders**.
4. Run **setup**, do a **New deployment**, and put the new URL in `public/config.json`.

## Troubleshooting

| What you see | Fix |
|---|---|
| "The backend asked for a Google sign-in" | The deployment's access isn't **Anyone**. Edit the deployment, or the account's domain blocks it (use a gmail.com account). |
| Changes to `Code.gs` don't take effect | Deploy a **new version** of the existing deployment (step 5). |
| Miles don't fill in from RideWithGPS | The route must be public or unlisted. For private routes add an RWGPS API key and auth token in Config. The planned miles still show. |
| Photo grid shows names instead of pictures | Sharing with link is blocked or turned off; tap a photo to open it in Drive. |
| No morning emails | Check the Email column in Riders, `Send Reminder Emails = TRUE`, and that the trigger exists (Apps Script → Triggers, clock icon). Re-run setup after changing Reminder Hour. |
| Someone is stuck on "Wrong PIN" | Clear their PIN Hash cell; they choose a new PIN on next sign-in. |
