# LinkedIn Filter: Applicant Exporter

A Chrome extension that exports the applicants on your own LinkedIn job posts into one Excel file, and shortlists only the people who have worked at the companies you care about.

It opens each applicant's LinkedIn profile, reads their full work history, matches it against your list of target companies, and gives you a ready shortlist with name, email, phone, scores and the exact line from their profile that matched.

![Version](https://img.shields.io/badge/version-1.2.0-1E7145) ![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-17323A)

## What it does

- Reads every applicant in the Hiring Pro list, including infinite scroll and "Show more"
- Collects email and phone where the applicant shared them
- Opens each applicant's LinkedIn profile in a background tab and reads their full work history
- Matches that history against your target companies (18 edtech and creator platforms by default, fully editable)
- Exports only the matches, or everyone, to a single Excel file
- Saves progress as it goes, so a closed tab or a Stop never loses data

## How it works

For each applicant, the extension:

1. Reads the list row: name, applied date, title, company, location, must-have and preferred scores.
2. Opens the applicant view to collect email, phone and the link to their profile.
3. Opens their LinkedIn profile in a background tab, reads the full Experience list, then closes the tab.
4. Checks that work history against your target company list, then keeps or drops the person.

Your job tab stays in front the whole time. Nothing is clicked on the applicant's profile, and nothing is saved, messaged or changed on LinkedIn.

## Install

You only do this once.

1. On this repo page, click the green **Code** button, then **Download ZIP**.
2. Unzip it into a folder you will keep, for example `Documents/linkedin-filter`. Do not delete this folder later, Chrome loads the extension from it.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** (toggle in the top right).
5. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Click the puzzle icon in the Chrome toolbar and pin **Applicant Exporter**.
7. Refresh any LinkedIn tab that was already open.

### Updating to a newer version

1. Download the ZIP again and replace the files in your folder (or run `git pull` if you cloned the repo).
2. Go to `chrome://extensions` and click the reload icon on **Applicant Exporter**.
3. Refresh your LinkedIn tabs.

## How to use

1. Open your job's applicant list in LinkedIn (the Hiring Pro screen).
2. Set the list filter. **Top fit** only covers the top fit applicants. Switch to all applicants if you want everyone checked.
3. Click **Export applicants** at the bottom right of the page. If it does not appear, click the extension icon and choose **Open exporter on this page**.
4. Choose your options (see the table below).
5. For your first run, set **Max applicants** to 3 and check the result before running on everyone.
6. Click **Start export**. Leave the tab open and in front while it runs. The panel shows each person as they are checked and whether they matched.
7. Click **Download Excel** when it finishes. The file goes to your Downloads folder.

Click **Stop** at any time. Everything checked so far is kept. If the tab closes mid-run, click the extension icon and use **Download last export**.

### Options

| Option | Default | What it does |
|---|---|---|
| Open each LinkedIn profile and read work history | On | Reads the applicant's full Experience list. This is what decides the shortlist. |
| Also collect email and phone | On | Opens the applicant view first. This is also where the profile link usually comes from, so keep it on. |
| Export only people who worked at a target company | On | Everyone else is checked and dropped from the file. Turn off to export everyone with match columns filled in. |
| Max applicants | All | Stop after checking this many people. Use it for test runs and for batching. |
| Pause between (sec) | 5 | Wait between applicants. Keep it at 5 or more. |
| Target companies | 18 companies | The list to match against. Edits are remembered. |

## Target companies

The default list:

Graphy (and Spayee), Classplus, Thinkific, TagMango, Teachable, Kajabi, Edmingle, EduGorilla, Superprofile, Topmate, Wise, LearnWorlds, TrainerCentral, Cosmofeed, Podia, Teachmint, Testpress, Nas.io.

To change it, open **Target companies** in the panel and edit the text. One company per line:

```
Graphy, Spayee
Classplus, Class plus
?Wise, Wise.live, WiseLive, Wise Live
TrainerCentral, Trainer Central, ?Zoho
```

Rules:

- The first item on a line is the name that appears in Excel. Everything after it is an alternative spelling or old brand name.
- A name with `?` in front is a loose match. People who match only on a loose name go to the **Possible match** column for you to check, not straight into the shortlist. Use it for ambiguous words: "Wise" is also a fintech, and "Zoho" covers far more than TrainerCentral.
- Matching is whole word and ignores capitals, so "Photography" never counts as Graphy.

## What is in the Excel file

| Sheet | Contents |
|---|---|
| Shortlist | Only people who matched, strong matches first, then possible matches |
| All applicants | Everyone exported (same as Shortlist when "Export only matches" is on) |
| Export info | Job, time of export, counts, and the company list used |

Columns:

| Column | Notes |
|---|---|
| Name, Applied on | Applied on is a real date, so it sorts correctly |
| Target company | Companies from your list found in their work history |
| Possible match (check) | Loose matches to verify yourself |
| Title, Company, Location | As shown in the applicant list |
| Must-have met / total, Preferred met / total | Numbers, so you can filter and sort |
| Qualifications (as shown) | The raw score text |
| Email, Phone | Only when the applicant shared them |
| Profile link | Clickable |
| Where it matched | The exact line from their profile that triggered the match |
| Work history (from profile) | The Experience text read from their profile |
| Profile read | Full work history read, Experience section read, No profile link on this applicant, LinkedIn asked to sign in, or Profile did not load |
| Full details | Everything shown in the applicant view, including screening answers |
| Detail scan status | Whether the applicant view opened and showed contact details |

## Using the file with Claude

Upload the Excel file to Claude and ask something like:

> These are applicants for [role]. Must-haves: [list]. Using the Shortlist sheet, rank the top 10, explain each pick in one line, and flag anyone with a notice period over 30 days.

The company match is a word match. For a second pass, ask Claude to read the "Work history" and "Full details" columns and catch anyone the word match missed, such as a subsidiary or a company described without its name.

## Timing

| Mode | Time per applicant | 100 applicants |
|---|---|---|
| Profiles plus contact details (default) | about 15 sec | about 25 min |
| Contact details only | about 8 sec | about 13 min |
| List only (all options off) | under 1 sec | under 1 min |

## Before you run it on everyone

Opening profiles is the part LinkedIn watches most closely:

- **Profile views are visible.** Applicants can see you in "Who viewed your profile". For people who applied to your job this is normal, but it is not silent.
- **There is a monthly profile view limit** on free and Premium accounts. Going over it blocks profile search until the next month. For hundreds of applicants, run in batches over a few days using **Max applicants**.
- **LinkedIn's User Agreement does not allow extensions that copy data from the site**, and it can restrict accounts that use them. This extension only runs when you click Start, handles one job at a time and pauses between people. That lowers the risk but does not remove it.
- Keep the pause at 5 seconds or more, and avoid running many jobs back to back.

## Troubleshooting

| Problem | What to do |
|---|---|
| "No applicants found on this page" | Make sure the list with "Applied on:" dates is on screen, then try again. |
| "No profile link on this applicant" | Keep **Also collect email and phone** on, since the link usually sits in the applicant view. Some applicants have no profile link exposed and need a manual look. |
| Several rows say "Profile did not load" | LinkedIn may be slowing you down. Stop, wait a few hours, and run the rest in a smaller batch. |
| "LinkedIn asked to sign in" | Your session expired. Sign in again in the same Chrome profile and rerun. |
| Email or phone is blank | The applicant may not have shared them. Check the Detail scan status column. |
| "Detail view did not open" | LinkedIn has likely changed its layout. Open DevTools (F12), go to Console, run the export on 2 applicants, and share a screenshot of the applicant view plus the lines starting with `[Applicant Exporter]`. |
| Someone you expected is not shortlisted | Check their "Work history" cell. If the company is not in that text, LinkedIn did not show it. Add the missing spelling to the target list or check them manually. |
| The Export button does not appear | Refresh the LinkedIn tab. If you just installed or updated the extension, open tabs need a refresh. |

## Candidate data

Exported files contain applicants' personal contact details.

- Share them only with the hiring team, and delete them once the role is filled.
- Never commit exported files to this repo. The `.gitignore` already blocks `.xlsx`, `.xls` and `.csv` files.

## Project structure

```
manifest.json        Extension config (Manifest V3)
content.js           Runs on LinkedIn: reads the list, opens applicants, reads profiles, shows the panel
background.js        Opens profile tabs in the background and saves the Excel file
export.js            Builds the Excel workbook (Shortlist, All applicants, Export info)
popup.html, popup.js Toolbar popup: open the panel, download or clear the last export
lib/                 SheetJS library for writing .xlsx files, with its license
icons/               Toolbar icons
```

The extension uses no LinkedIn class names. It finds applicant rows by their "Applied on:" text and maps columns by the position of the table headers, so it survives most LinkedIn layout changes.

## Version history

| Version | Changes |
|---|---|
| 1.2.0 | Opens each applicant's LinkedIn profile and matches on full work history. Option to export only matches. |
| 1.1.0 | Target company matching, Shortlist sheet, editable company list. |
| 1.0.0 | Applicant list export to Excel with email, phone and applicant details. |

## Credits

Excel files are built with [SheetJS Community Edition](https://sheetjs.com), licensed under Apache 2.0. See `lib/SHEETJS-LICENSE.txt`.
