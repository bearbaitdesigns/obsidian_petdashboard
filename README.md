# Pet Dashboard for Obsidian

Track vet visits, medications, vaccines, weight and observations for each of your pets, and see whether pet insurance (including multi-pet plans) is worth what it costs. Creates PDF reports.

## Install with BRAT

1. In Obsidian, install **BRAT** from **Settings → Community plugins → Browse** (search "BRAT") and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing** (or open **Settings → BRAT → Add beta plugin**).
3. Enter `bearbaitdesigns/obsidian_petdashboard` and choose the latest version.
4. Enable **Pet Dashboard** in **Settings → Community plugins**.
5. Click the paw icon in the left ribbon, or run **Pet Dashboard: Open dashboard** from the command palette.

BRAT checks this repository for new releases and can update the plugin for you.

### Manual install

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/bearbaitdesigns/obsidian_petdashboard/releases/latest) into `.obsidian/plugins/pet-dashboard/` in your vault, then enable **Pet Dashboard** in **Settings → Community plugins**.

## Test data (two pets)

Either:

- **In the app:** on the welcome card or in **Settings → Pet Dashboard → Load sample pets**. Dates are generated relative to today, so it always looks current. Your own records are kept.
- **From the file:** with Obsidian closed, copy [`sample-data/data.json`](sample-data/data.json) into `.obsidian/plugins/pet-dashboard/`. This **replaces** any data already there.

The sample household:

- **Biscuit**, a 5-year-old Golden Retriever: ear infection, a leg strain, a $3,850 emergency surgery for a swallowed sock, skin allergies, a denied dental claim, a pending claim, an overdue vaccine, a refill due and a visit with no claim recorded.
- **Mochi**, a Domestic Shorthair cat adopted from a shelter with an unknown birth date (age estimated at 18 months in Sep 2024, so she now shows as about 3 years 8 months): was on her own policy (Whisker Shield), then **joined Biscuit's plan three months after it started**, turning it into a shared multi-pet plan (Paws & Claws Mutual: $58/month for Biscuit alone, $86 once Mochi joined, $94 after renewal; premium split 65/35; $250 deductible per pet). The whole plan is paying off thanks to Biscuit's surgery; Mochi's own share is not.

## Using it

- **Rename:** click the pencil next to the title. Choose *Pet Dashboard* (default), *[pet's name] Dashboard*, or a custom name. Each pet keeps its own.
- **More pets:** use **Add pet** in the header. With two or more pets, a row of pet buttons appears under the Overview / Insurance / Health tabs. On the Insurance tab it also has a **Whole plan** button for each multi-pet plan, so you can switch between the whole plan and each pet's share. Your Insurance choice is remembered when you switch tabs.
- **Unknown birth date:** in the pet's profile set *Date of birth* to *Unknown — estimate the age*, enter years and months, and the date the estimate was made. The age keeps counting up from that date automatically and is shown as "about … (estimated)".
- **Species:** pick from the suggestions or type any species (e.g. *Bearded dragon*, *Axolotl*). New ones are added to the suggestions; edit the list in **Settings → Pet Dashboard → Species**. The icon adapts where it can (dog, cat, bird, rabbit, fish, reptile, small rodent…), otherwise a paw.
- **Photo:** click the paw icon by the title, the avatar in the profile, or **Add photo**. A head shot works best. Drag to position and use the slider to zoom; it is cropped to a square and shown in a circle, larger than the icon. Choose Small, Medium or Large in settings. Photos are saved in `Pet Dashboard/Photos` in your vault and also appear in PDF report headers. Replacing or removing a photo moves the old file to the trash.
- **Vet contacts:** each pet's profile has a primary vet and an emergency vet (clinic, phone, address). They show in the profile, in a **Vet contacts** card at the top of the Health tab (phone numbers are tap-to-call), and in the PDFs.
- **Overview tab:** profile, items needing attention, health and insurance snapshots, 12-month money chart, recent activity, and an all-pets table.
- **Insurance tab:** verdict, premiums vs reimbursements, policy-year deductible and limit, claims, possibly-unclaimed visits, policies and premium history. The **?** in the top-right corner explains how pet insurance and every calculation works, and holds the insurance settings. Underlined words show a definition on hover (or keyboard focus).
- **Multi-pet plans:** when adding or editing a policy, tick every pet it covers, choose how the premium is split, and whether the deductible and annual limit apply per pet or are shared. Set **Joined the policy on** for a pet added later (and **Left the policy on** if one is removed); that pet is only charged a share, and only covered, from that date. Record the new premium with **Rate change** (reason: pet added). Use the **Whole plan** and pet buttons under the tabs to switch between the whole plan and each pet's share; the policy card shows each pet's dates on the plan.
- **What-if planner:** the **What if…** button on the Insurance tab (or **Insurance: What-if planner** in the command palette) opens a sandbox. Nothing you do there changes your records, and scenarios are saved so you can come back to them.
  - **Scenarios:** create as many as you like. Start blank, pick a quick idea (an emergency next month, open claims paid or denied, ongoing medication, a premium rise at renewal, cancelling today, a 90% plan, a higher deductible), or duplicate one. Each gets its own colour and can be hidden from the chart.
  - **Changes:** a claim outcome, a new vet bill, ongoing treatment, a premium change, or cancelling (or taking one pet off a multi-pet plan). Each can start now, in a number of months, at the pet's age, or on a date.
  - **Plan terms:** try a different premium, deductible, reimbursement rate or annual limit. They're applied to your whole history, as if you'd had that plan all along.
  - **Results against your current plan:** back per $1 paid, net benefit, your total cost, premiums, reimbursed and limit left, each with the change vs current; a running net benefit chart for all scenarios; and an all-scenarios comparison table. A **Viewing** band under the estimate notice shows (and, for a multi-pet plan, switches) whether you're looking at the whole plan or one pet's share. Results are shown as of today, in 6 or 12 months, or at the end of the policy year.
  - **Save as PDF:** choose the scenarios to include. The PDF has your current plan, a comparison table and chart, each scenario's terms, changes, notes and results, and how it's calculated.
- **Chart details:** hover over any chart (or tap it, or focus it and use the arrow keys) to see that month's or weigh-in's figures, running totals, net and changes.
- **Archive a pet:** in the profile, **Archive** — for a pet that has crossed the rainbow bridge, been rehomed or lost. The history stays and can still be edited and printed; reminders stop; age stops at that date; current medications are ended; and you can remove the pet from its policies from that date, so a shared plan carries on for your other pets. Open claims keep showing until you record the outcome. Archived pets sit behind an **Archived** button in the header and can be restored.
- **Delete a pet:** **Delete** in the pet's profile (or in the pet's Edit form, or **Settings → Pet Dashboard**). The dialog lists exactly what will be removed: the pet's records, claims and photo; any policy that only covered that pet; and the pet's changes in What-if scenarios. On a shared plan, the pet is taken off and the plan carries on for your other pets. Type the pet's name to confirm. Deleting can't be undone, so the dialog also offers **Archive instead**, which keeps the history.
- **Health tab:** upcoming items, vet visits (a future date = an appointment), medications, vaccinations, weight chart, observations and notes. Click the pencil on any row to edit or delete it.
- **PDFs:** the **PDF** button on any tab (or the command palette) creates a Health report, Insurance summary, or Full report for a period you choose. On desktop it is saved to `Pet Dashboard/Reports` in your vault and opened; change the folder and page size in settings. On mobile the system print dialog opens instead (choose *Save as PDF*).
- **Embed in a note:** add a code block

  ````
  ```pet-dashboard
  tab: insurance
  pet: Biscuit
  ```
  ````

  `tab` can be `overview`, `insurance` or `health`; `pet` is optional.

## Your data

Everything is stored in `.obsidian/plugins/pet-dashboard/data.json` inside your vault, so it is backed up and synced with the vault. Nothing is sent anywhere.

Sample PDF reports made from the test data are in [`sample-reports/`](sample-reports/).

## Building from source

The plugin has no dependencies or bundler. `src/` is split into numbered files that `build.sh` joins into `main.js`:

```sh
./build.sh
```

To release a new version: bump `version` in `manifest.json` and add it to `versions.json`, run `./build.sh`, and commit. Then on GitHub open **Actions → Release → Run workflow**. It checks the version is new, confirms `main.js` matches the source, and publishes a release tagged with the version (for example `1.1.1`) with `main.js`, `manifest.json` and `styles.css` attached. BRAT picks it up from there.
