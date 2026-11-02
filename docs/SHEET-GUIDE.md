# The master sheet, tab by tab

The app reads column **names**, so you can reorder columns or add your own columns; just don't rename the ones below. Dates are `yyyy-mm-dd`. Several people in one cell are separated by commas (`Sam Rivera, Leo Kim`). `Everyone` works anywhere a person goes.

## Tabs leaders fill in

### Riders
| Column | What to put |
|---|---|
| Name | Full name, exactly as it should appear. People sign in by picking it. |
| Role | `Rider`, `Leader` or `Route master`. Leaders and the route master can edit anything, change routes and add jobs, and get accident alerts. |
| Phone | For one-tap calling and texting in the app. |
| Email | Morning reminder emails go here. Leave blank for no emails. |
| Can Drive | Tick for people on the van rotation. Only they appear in "Change driver". |
| Notify Topic | Optional. An ntfy topic name for phone notifications (see the install guide). Make it hard to guess, e.g. `i4k27-maya-x8k2p`. |
| Emergency Contact | Name and phone. Only leaders see it in the app. |
| PIN Hash | Leave empty. Filled when the person first signs in. Clear it to reset a PIN, or type 4–8 digits to set a starting PIN. |

### Itinerary (one row per day)
| Column | What to put |
|---|---|
| Day | 1, 2, 3… |
| Date | The date of that day. The app opens on the row matching today's date. |
| From / To | `Pittsburgh, PA`. The city is used for the weather if there are no coordinates. |
| Planned Miles | Your estimate. Shown with "≈" until the route is added. |
| RWGPS Link | The RideWithGPS route link. The route master can paste it here or in the app; the app fills **Route Miles**, **Elevation Gain (ft)** and the start/end coordinates. Use the sheet menu *Refresh mileage from RideWithGPS* after pasting links in bulk. |
| Start Lat / Lon, End Lat / Lon | Optional; filled from RideWithGPS. Used for weather and wind direction. |
| Stayover ID | The ID of the night's stayover in the Stayovers tab, e.g. `S12`. Two nights at one place (a rest day) use the same ID. |
| Driver | Van driver(s) for the day. Riders can swap in the app; swaps are logged in DriverSwaps. |
| Route Leader | Optional. Gets the "add the route" job if the link is missing the day before. |
| Rest Day | Tick for rest days. |
| Route Notes | From the route master: turns, lunch stop, hazards. |
| Notes From Previous Riders | Paste last year's route comments for this day. |

### Stayovers (one row per place)
| Column | What to put |
|---|---|
| ID | Short and unique: `S1`, `S2`… matching Itinerary. |
| Name, Address, City | Shown with a Directions button. |
| Lat / Lon | Optional, for directions when there's no street address. |
| Contact Name / Phone / Email | The host. One tap to call from the app. |
| Check-in Time / Check-out Time | e.g. `4:00 PM`. |
| Dinner / Breakfast / Lunch | What's arranged: `Donated by the Lions Club`, `We cook`, `Bring our own`. |
| Showers / Laundry / Sleeping / WiFi / Van Parking | Anything useful: `6 (locker room)`, `Floor, bring pads`. |
| Notes | Door codes, rules, parking. |
| Caller | Who calls to reconfirm. They see "Call to confirm" for any unconfirmed stayover arriving within **Confirm Days Ahead** days (5 by default) and get it in their morning reminder. |
| Confirmed / Confirmed By / Confirmed At / Call Notes | Filled from the app when the caller ticks it. |

### Duties (jobs)
| Column | What to put |
|---|---|
| ID | Anything unique (the app fills it for jobs added in the app). |
| Day | Day number. |
| Person | Name(s) or `Everyone`. |
| Duty / Details | `Write the blog post` / `Send to Avery by 9 pm`. |
| Done / Done By / Done At | Ticked from the app. |

Driving, stayover calls and adding routes don't need rows here: the app works those out from the other tabs.

### Config
Team name, team code, how many days ahead stayovers are reconfirmed, reminder hour, emergency info shown on the Team screen, folder IDs and the optional RideWithGPS API key. Each row has a note.

## Tabs the app fills

Checkins, Journals, Reports, Gas, Expenses, Donations, Interviews, Media and DriverSwaps get a row for everything people log. You can sort, filter and total them like any sheet; for example, filter Expenses by **Reimburse To** for the treasurer, or Donations by **Thank You Sent**. The **Receipt Link** / **File Link** columns link straight to the photo in Drive. Avoid editing the **ID** column.
