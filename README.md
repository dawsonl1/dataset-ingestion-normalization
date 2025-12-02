# Ella Rises CSV Normalization Web App

This project is a small Node.js/Express web application that:

- Accepts a CSV upload via a 1-page web UI.
- Loads raw rows into a Postgres staging table (`stagingrawsurvey`).
- Normalizes the data into a relational schema (`participantinfo`, `eventtypes`, `eventinstances`, `participantattendanceinstances`, `surveyinstances`, `participantmilestones`, `participantdonations`).
- Archives the raw staging rows into `stagingarchive`.
- Optionally records drop reasons into an audit table (`normalization_audit`).

This README explains how to get it running on a **new machine**.

---

## 1. Prerequisites

- **Node.js** (v18+ recommended)
- **npm** (comes with Node)
- **PostgreSQL** (local instance)
- Ability to run `psql` against your Postgres server

---

## 2. Clone / copy the project

On the target machine, place this project directory somewhere convenient, e.g.

```bash
cd /path/to
# copy or git clone the project into Intex-database-setup/
```

Then:

```bash
cd Intex-database-setup
```

> Do **not** commit `.env`, `uploads/`, or `node_modules/` — they are in `.gitignore`.

---

## 3. Install Node dependencies

From the project root:

```bash
npm install
```

This installs packages from `package.json`, including:

- `express`, `ejs`
- `multer`, `csv-parser`
- `knex`, `pg`, `dotenv`, `luxon`
- `nodemon` (used by the `npm run start` script)

---

## 4. Set up PostgreSQL schema

1. Start Postgres and ensure you can connect with `psql`.

2. Create the database and tables as specified in `creation_process.txt`.

   In `psql`:

   ```sql
   create database ella_rises;
   \c ella_rises;
   ```

3. Copy/paste and run **all the `create table` statements** from `creation_process.txt` in order, including:

   - `participantinfo`
   - `participantdonations`
   - `participantmilestones`
   - `eventtypes`
   - `eventinstances`
   - `participantattendanceinstances`
   - `surveyinstances`
   - `stagingrawsurvey`
   - `stagingarchive`
   - `normalization_audit` (from `normalization_audit.txt`)

   Make sure `participantdonations` uses:

   ```sql
   create table participantdonations (
       donationid      serial primary key,
       participantid   int references participantinfo(participantid),
       donationno      int,
       donationdate    date,
       donationamount  numeric(10,2)
   );
   ```

   And `normalization_audit` is created using the DDL in `normalization_audit.txt`.

---

## 5. Configure environment variables

Create a `.env` file in the project root (there is an example already in this repo). On a new machine you will likely need to adjust `DB_USER` and possibly `DB_PASSWORD`:

```ini
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=ella_rises
SESSION_SECRET=some_long_random_string
PORT=3012
```

- `DB_USER` / `DB_PASSWORD` must be a Postgres user with privileges on `ella_rises`.
- `PORT` is the HTTP port used by Express.

The `util/db` module reads this `.env` and configures Knex for PostgreSQL.

---

## 6. Start the web server

From the project root:

```bash
npm run start
```

This runs `nodemon index.js`, which:

- Starts Express on `http://localhost:PORT` (default `http://localhost:3012`).
- Registers:
  - `GET /` → renders the CSV upload page (`views/upload.ejs`).
  - `POST /upload` → handles CSV upload + normalization.

Watch the terminal for logs such as:

- `Server listening on http://localhost:3012`
- `--- Upload started ---`
- `[staging] ...`
- `[normalize] ...`

---

## 7. Uploading a CSV and running normalization

1. In a browser, open:

   ```
   http://localhost:3012/
   ```

2. Use the form to select a CSV file.

   The CSV **must** have the headers described in `creation_process.txt`:

   ```text
   ParticipantEmail,ParticipantFirstName,ParticipantLastName,ParticipantDOB,ParticipantRole,ParticipantPhone,ParticipantCity,ParticipantState,ParticipantZip,ParticipantSchoolOrEmployer,ParticipantFieldOfInterest,EventName,EventType,EventDescription,EventRecurrencePattern,EventDefaultCapacity,EventDateTimeStart,EventDateTimeEnd,EventLocation,EventCapacity,EventRegistrationDeadline,RegistrationStatus,RegistrationAttendedFlag,RegistrationCheckInTime,RegistrationCreatedAt,SurveySatisfactionScore,SurveyUsefulnessScore,SurveyInstructorScore,SurveyRecommendationScore,SurveyOverallScore,SurveyNPSBucket,SurveyComments,SurveySubmissionDate,MilestoneTitles,MilestoneDates,DonationHistory,TotalDonations
   ```

3. Click **Upload & Normalize**.

The server will:

1. Save the file temporarily to `uploads/` via **Multer**.
2. Stream it through **csv-parser** into in-memory row objects.
3. Use `etl/mapCsvToStaging.js` to:
   - Map each CSV row into the `stagingrawsurvey` schema.
   - Insert them in batches (raw text, no validation) using Knex.
4. Call `etl/normalize.js` to:
   - Normalize participants, events, attendance, survey, milestones, donations.
   - Archive all staging rows into `stagingarchive`.
   - Truncate `stagingrawsurvey`.
   - Truncate `normalization_audit` at the beginning of each run.

If everything succeeds, the UI shows a success message and the console prints:

```text
--- Upload + normalization completed successfully ---
```

---

## 8. Using the audit table for debugging drops

The `normalization_audit` table records staging rows that are skipped for key reasons, while still preserving their participant-level data.

On each run of `runNormalization`:

- `normalization_audit` is **truncated** at the start.
- For any row with missing `participantemail`:
  - A row is inserted with `reason = 'missing participantemail'`.
- For any row where event data is incomplete:
  - If `eventname` is missing: `reason = 'missing eventname (skipped event/attendance/survey)'`.
  - If `eventdatetimestart` is missing/invalid: `reason = 'missing or invalid eventdatetimestart (skipped event/attendance/survey)'`.
- Each audit row includes:
  - `rowid` from `stagingrawsurvey`
  - All `participant*` columns (email, name, DOB, role, phone, city, state, zip, school/employer, field of interest)

Typical queries:

```sql
-- All audited drops for the last run
select * from normalization_audit;

-- Simple count comparison
select count(*) from stagingrawsurvey;        -- after upload, before normalization
select count(*) from participantinfo;         -- total normalized participants
select count(*) from normalization_audit;     -- total audited drops (key reasons only)
```

> Note: With a fully valid CSV (all required fields present), `normalization_audit` may be empty — that is expected.

---

## 9. Verifying normalized data

After an upload/normalization run, you can inspect the tables in `ella_rises`:

```sql
-- Participants
select * from participantinfo;

-- Event types and instances
select * from eventtypes;
select * from eventinstances;

-- Attendance and surveys
select * from participantattendanceinstances;
select * from surveyinstances;

-- Milestones and donations
select * from participantmilestones;
select * from participantdonations;

-- Staging archive
select * from stagingarchive;
```

Because the pipeline is **idempotent with respect to natural keys**:

- Re-uploading overlapping history will **reuse** existing participants, events, and attendance where appropriate.
- Milestones and donations are deduplicated based on `(participantid, title/date)` or `(participantid, date, amount)`.

---

## 10. Common issues on a new machine

- **Cannot connect to Postgres**
  - Check `.env` database credentials and host/port.
  - Ensure Postgres is running and accessible.

- **Relation does not exist** (e.g., `stagingrawsurvey` or `normalization_audit`)
  - Confirm you ran all `create table` statements from `creation_process.txt` and `normalization_audit.txt` in the `ella_rises` database.

- **CSV headers don’t line up**
  - Ensure the header row exactly matches the expected list.
  - The code tolerates a UTF-8 BOM on the first header (e.g., from Excel) but not arbitrary name changes.

Once those are in place, the app should run identically on any machine with Node and Postgres installed.
