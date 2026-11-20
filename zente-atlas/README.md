# ZENTE ATLAS — Venues & Spaces

Your own venue map: a dark street map of clubs, event spaces and venues in every city, with a private owner view for business intel and a clean client view you can share.

## What's in this folder

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app (no build step, deploys anywhere) |
| `config.js` | Your settings: name, tagline, contact email, Google Sheet link, start city |
| `venues.json` | Public starter list (24 Austin venues), used until your sheet is connected |
| `apps-script/Code.gs` | The Google Sheet bridge: makes your sheet the live database |

## How the pieces fit

```
ZENTE'S WORLD (Venues tab)  ⇄  Google Sheet tab "ZENTES_WORLD_Venues"  ⇄  ZENTE ATLAS
   edit, score, research          the single source of truth                 map, clients
```

- Edit in World, in the sheet, or add from the Atlas. Everything meets in the sheet.
- Clients only ever receive public columns. Rent, liquor sales, owners, contacts, notes and scores stay private unless your owner key is entered.

## Step 1 — Put it online (pick one)

**A. Vercel (recommended, same as your EPK and consulting site).**
Create a GitHub repo named `zente-atlas`, upload this folder, then in Vercel choose **Add New → Project → Import** that repo. Framework preset: **Other**. No build command. Deploy. To give it its own domain later (e.g. `atlas.zentimusic.com`), use Project → Settings → Domains.

**B. Fastest (2 minutes).** Go to app.netlify.com/drop and drag this folder in. You get a live link immediately.

## Step 2 — Connect your Google Sheet (makes it live)

1. In ZENTE'S WORLD → Venues, tap **⇄ Sync with Google Sheet** once. This creates the `ZENTES_WORLD_Venues` tab.
2. Open the sheet → **Extensions → Apps Script**. Delete what's there, paste `apps-script/Code.gs`, and save.
3. Reload the sheet. A **ZENTE Atlas** menu appears. Run **Set owner key…** and choose a long passphrase.
4. Run **Fill missing map coordinates**. This puts every venue on the map using Google's geocoder.
5. Run **Update Texas liquor sales**. This fills monthly liquor sales for Texas venues from Texas Comptroller data.
6. In Apps Script: **Deploy → New deployment → Web app**. Set Execute as: **Me**. Set Who has access: **Anyone**. Copy the web-app URL.
7. Paste that URL into `config.js` → `SHEET_API`, then redeploy (or push to GitHub).
8. Open the Atlas → **Owner** → enter your passphrase. Private intel and scouting tools appear on that device.

## Using it

- **Search any city** and press Enter to fly there. Then **✦ Scout this area** (owner view) shows every nightclub, music venue and event space OpenStreetMap knows about there as grey pins. Tap one → **+ Add to Atlas** saves it to your sheet (status: Scouting).
- **Texas liquor receipts.** In owner view, open a venue and tap **Texas liquor receipts · official data**. You see the last 12 months of mixed-beverage receipts, the operating entity, the permit number and when that permit started. You can save the average to the sheet.
- **Share with a client.** Tick venues to build a shortlist → **Share** → copy the link. Clients see a clean view with an **Inquire** button that emails you.
- **Pin colors** show venue type in the client view and deal status in the owner view. Pin size shows capacity.

## Research in chat

Ask Claude in ZENTE'S WORLD something like "research the top clubs and event spaces in Tulum". Results go into World's Venues tab with sources. Sync to the sheet, and the Atlas shows them.

## Data notes

- Capacities in the starter list come from public sources (DJ Mag, the Austin Chronicle, the City of Austin special-events venue list, Cvent, venue listings). Each venue lists its source. Verify the numbers on a walkthrough.
- Rent, lease terms and owner details aren't public for most venues. Fill those from your own intel.
- Map © OpenStreetMap contributors, tiles by OpenFreeMap (free, including for commercial use). Venue search and scouting use OpenStreetMap's Nominatim and Overpass services; please keep usage light.
