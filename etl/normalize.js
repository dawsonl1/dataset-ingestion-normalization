const { DateTime } = require('luxon');

function toNullIfBlank(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function parseDate(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const dt = DateTime.fromFormat(v, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
  if (dt.isValid) return dt.toJSDate();
  const dt2 = DateTime.fromISO(v, { zone: 'utc' });
  return dt2.isValid ? dt2.toJSDate() : null;
}

function parseDateOnly(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const dt = DateTime.fromFormat(v, 'yyyy-MM-dd', { zone: 'utc' });
  if (dt.isValid) return dt.toJSDate();
  const dt2 = DateTime.fromISO(v, { zone: 'utc' });
  return dt2.isValid ? dt2.toJSDate() : null;
}

function parseIntOrNull(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function parseFloatOrNull(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function parseBoolean(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['true', '1', 'yes'].includes(lower)) return true;
  if (['false', '0', 'no'].includes(lower)) return false;
  return null;
}

function normalizeNpsBucket(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower === 'promoter') return 'Promoter';
  if (lower === 'passive') return 'Passive';
  if (lower === 'detractor') return 'Detractor';
  return null;
}

function normalizePhone(value) {
  const v = toNullIfBlank(value);
  if (!v) return null;
  const digits = v.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

async function auditDrop(knex, row, reason) {
  if (!row || !row.rowid) return;

  try {
    await knex('normalization_audit').insert({
      rowid: row.rowid,
      reason,
      participantemail: row.participantemail,
      participantfirstname: row.participantfirstname,
      participantlastname: row.participantlastname,
      participantdob: row.participantdob,
      participantrole: row.participantrole,
      participantphone: row.participantphone,
      participantcity: row.participantcity,
      participantstate: row.participantstate,
      participantzip: row.participantzip,
      participantschooloremployer: row.participantschooloremployer,
      participantfieldofinterest: row.participantfieldofinterest,
    });
    console.log('[normalize][audit] Logged dropped/partial row', { rowid: row.rowid, reason });
  } catch (auditErr) {
    console.error('[normalize][audit] Failed to insert normalization_audit row', { rowid: row.rowid, reason, error: auditErr });
  }
}

async function getOrCreateParticipant(knex, row) {
  const email = toNullIfBlank(row.participantemail);
  if (!email) return null;

  const existing = await knex('participantinfo')
    .where({ participantemail: email })
    .first();

  const base = {
    participantemail: email,
    participantfirstname: toNullIfBlank(row.participantfirstname),
    participantlastname: toNullIfBlank(row.participantlastname),
    participantdob: parseDateOnly(row.participantdob),
    participantrole: toNullIfBlank(row.participantrole),
    participantphone: normalizePhone(row.participantphone),
    participantcity: toNullIfBlank(row.participantcity),
    participantstate: toNullIfBlank(row.participantstate),
    participantzip: toNullIfBlank(row.participantzip),
    participantschooloremployer: toNullIfBlank(row.participantschooloremployer),
    participantfieldofinterest: toNullIfBlank(row.participantfieldofinterest),
  };

  if (existing) {
    console.log('[participant] Reusing existing participant', { email, participantId: existing.participantid });
    return existing.participantid;
  }

  const [inserted] = await knex('participantinfo')
    .insert(base)
    .returning('participantid');

  const participantId = inserted.participantid ?? inserted;
  console.log('[participant] Inserted new participant', { email, participantId });
  return participantId;
}

async function getOrCreateEventType(knex, row) {
  const eventName = toNullIfBlank(row.eventname);
  if (!eventName) return null;

  const existing = await knex('eventtypes')
    .where({ eventname: eventName })
    .first();

  if (existing) {
    console.log('[eventtype] Reusing existing event type', { eventName });
    return eventName;
  }

  await knex('eventtypes').insert({
    eventname: eventName,
    eventtype: toNullIfBlank(row.eventtype),
    eventdescription: toNullIfBlank(row.eventdescription),
    eventrecourrancepatter: toNullIfBlank(row.eventrecurrencepattern),
    eventdefaultcapacity: parseIntOrNull(row.eventdefaultcapacity),
  });
  console.log('[eventtype] Inserted new event type', { eventName });
  return eventName;
}

async function getOrCreateEventInstance(knex, row) {
  const eventName = toNullIfBlank(row.eventname);
  const start = parseDate(row.eventdatetimestart);
  if (!eventName || !start) return null;

  const existing = await knex('eventinstances')
    .where({ eventname: eventName, eventdatetimestart: start })
    .first();

  if (existing) {
    console.log('[eventinstance] Reusing existing event instance', { eventName, eventStart: start, instanceId: existing.instanceid });
    return existing.instanceid;
  }

  const [inserted] = await knex('eventinstances')
    .insert({
      eventname: eventName,
      eventdatetimestart: start,
      eventdatetimeend: parseDate(row.eventdatetimeend),
      eventlocation: toNullIfBlank(row.eventlocation),
      eventcapacity: parseIntOrNull(row.eventcapacity),
      eventregistrationdeadline: parseDate(row.eventregistrationdeadline),
    })
    .returning('instanceid');

  const instanceId = inserted.instanceid ?? inserted;
  console.log('[eventinstance] Inserted new event instance', { eventName, eventStart: start, instanceId });
  return instanceId;
}

async function getOrCreateAttendance(knex, participantId, instanceId, row) {
  if (!participantId || !instanceId) return null;

  const existing = await knex('participantattendanceinstances')
    .where({ participantid: participantId, instanceid: instanceId })
    .first();

  if (existing) {
    console.log('[attendance] Reusing existing attendance', { participantId, instanceId, attendanceId: existing.attendanceinstanceid });
    return existing.attendanceinstanceid;
  }

  const [inserted] = await knex('participantattendanceinstances')
    .insert({
      participantid: participantId,
      instanceid: instanceId,
      eventdatetimestart: parseDateOnly(row.eventdatetimestart),
      registrationstatus: toNullIfBlank(row.registrationstatus),
      registrationattendedflag: parseBoolean(row.registrationattendedflag),
      registrationcheckintime: parseDate(row.registrationcheckintime),
      registrationcreateddate: parseDate(row.registrationcreatedat),
    })
    .returning('attendanceinstanceid');

  const attendanceId = inserted.attendanceinstanceid ?? inserted;
  console.log('[attendance] Inserted new attendance', { participantId, instanceId, attendanceId });
  return attendanceId;
}

async function createSurveyIfNeeded(knex, attendanceId, row) {
  if (!attendanceId) return;

  const fields = [
    row.surveysatisfactionscore,
    row.surveyusefulnessscore,
    row.surveyinstructorscore,
    row.surveyrecommendationscore,
    row.surveyoverallscore,
    row.surveynpsbucket,
    row.surveycomments,
    row.surveysubmissiondate,
  ];

  const hasNonEmpty = fields.some((f) => toNullIfBlank(f) !== null);
  if (!hasNonEmpty) {
    console.log('[survey] No survey fields present, skipping survey for attendance', { attendanceId });
    return;
  }

  const existing = await knex('surveyinstances')
    .where({ attendanceinstanceid: attendanceId })
    .first();

  if (existing) {
    console.log('[survey] Survey already exists for attendance, skipping insert', { attendanceId });
    return;
  }

  await knex('surveyinstances').insert({
    attendanceinstanceid: attendanceId,
    surveysatisfactionscore: parseFloatOrNull(row.surveysatisfactionscore),
    surveyusefulnesscore: parseFloatOrNull(row.surveyusefulnessscore),
    surveyinstructorscore: parseFloatOrNull(row.surveyinstructorscore),
    surveyrecommendationscore: parseFloatOrNull(row.surveyrecommendationscore),
    surveyoverallscore: parseFloatOrNull(row.surveyoverallscore),
    surveynpsbucket: normalizeNpsBucket(row.surveynpsbucket),
    surveycomments: toNullIfBlank(row.surveycomments),
    surveysubmissiondate: parseDate(row.surveysubmissiondate),
  });
  console.log('[survey] Inserted survey for attendance', { attendanceId });
}

async function createMilestonesIfNeeded(knex, participantId, row) {
  if (!participantId) return;

  const titlesRaw = toNullIfBlank(row.milestonetitles);
  const datesRaw = toNullIfBlank(row.milestonedates);

  if (!titlesRaw && !datesRaw) {
    console.log('[milestones] No milestone data, skipping for participant', { participantId });
    return;
  }

  const titles = titlesRaw ? titlesRaw.split(';').map((t) => t.trim()) : [];
  const dates = datesRaw ? datesRaw.split(';').map((d) => d.trim()) : [];
  const maxLen = Math.max(titles.length, dates.length);

  for (let i = 0; i < maxLen; i += 1) {
    const title = titles[i] || null;
    const date = dates[i] ? parseDateOnly(dates[i]) : null;

    if (!title && !date) continue;

    // Check for existing milestone with same natural key
    // eslint-disable-next-line no-await-in-loop
    const existing = await knex('participantmilestones')
      .where({
        participantid: participantId,
        milestonetitle: title || null,
        milestonedate: date || null,
      })
      .first();

    if (existing) {
      console.log('[milestones] Skipping duplicate milestone', { participantId, title, date });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await knex('participantmilestones').insert({
      participantid: participantId,
      milestonetitle: title,
      milestonedate: date,
    });
    console.log('[milestones] Inserted milestone', { participantId, title, date });
  }

  // Recompute milestoneno ordering for this participant
  const milestones = await knex('participantmilestones')
    .where({ participantid: participantId })
    .orderBy([{ column: 'milestonedate', order: 'asc' }, { column: 'participantmilestoneid', order: 'asc' }]);

  for (let i = 0; i < milestones.length; i += 1) {
    const m = milestones[i];
    // eslint-disable-next-line no-await-in-loop
    await knex('participantmilestones')
      .where({ participantmilestoneid: m.participantmilestoneid })
      .update({ milestoneno: i + 1 });
  }
  console.log('[milestones] Recomputed milestoneno for participant', { participantId, count: milestones.length });
}

async function createDonationsIfNeeded(knex, participantId, row) {
  if (!participantId) return;

  const historyRaw = toNullIfBlank(row.donationhistory);
  if (!historyRaw) {
    console.log('[donations] No donation history, skipping for participant', { participantId });
    return;
  }

  const entries = historyRaw
    .split(';')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const entry of entries) {
    const [datePart, amountPart] = entry.split(':');
    const donationDate = parseDateOnly(datePart);
    const amountString = amountPart ? amountPart.replace(/[^0-9.\-]/g, '') : null;
    const donationAmount = amountString ? parseFloatOrNull(amountString) : null;

    if (!donationDate && donationAmount === null) {
      // eslint-disable-next-line no-continue
      console.log('[donations] Entry could not be parsed, skipping', { participantId, entry });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const existing = await knex('participantdonations')
      .where({
        participantid: participantId,
        donationdate: donationDate,
        donationamount: donationAmount,
      })
      .first();

    if (existing) {
      // eslint-disable-next-line no-continue
      console.log('[donations] Skipping duplicate donation', { participantId, donationDate, donationAmount });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await knex('participantdonations').insert({
      participantid: participantId,
      donationdate: donationDate,
      donationamount: donationAmount,
    });
    console.log('[donations] Inserted donation', { participantId, donationDate, donationAmount });
  }

  // Recompute donationno for this participant
  const donations = await knex('participantdonations')
    .where({ participantid: participantId })
    .orderBy([{ column: 'donationdate', order: 'asc' }, { column: 'donationid', order: 'asc' }]);

  for (let i = 0; i < donations.length; i += 1) {
    const d = donations[i];
    // eslint-disable-next-line no-await-in-loop
    await knex('participantdonations')
      .where({ donationid: d.donationid })
      .update({ donationno: i + 1 });
  }
  console.log('[donations] Recomputed donationno for participant', { participantId, count: donations.length });
}

async function runNormalization(knex) {
  console.log('--- Normalization run started ---');

  // Clear any previous audit entries so each upload run has a fresh audit set
  try {
    console.log('[normalize] Truncating normalization_audit (start of run)');
    await knex('normalization_audit').truncate();
  } catch (err) {
    console.error('[normalize] Failed to truncate normalization_audit', err);
  }

  const rows = await knex('stagingrawsurvey').select('*');
  console.log('[normalize] Loaded rows from stagingrawsurvey', { rowCount: rows.length });

  let processedCount = 0;
  let skippedNoEmail = 0;

  for (const row of rows) {
    const hasParticipantEmail = toNullIfBlank(row.participantemail);
    if (!hasParticipantEmail) {
      // Skip full normalization for this row
      // Before skipping, write an audit record so we know why it was dropped
      // eslint-disable-next-line no-await-in-loop
      await auditDrop(knex, row, 'missing participantemail');

      // eslint-disable-next-line no-continue
      skippedNoEmail += 1;
      console.log('[normalize] Skipping row with missing participantemail', { rowid: row.rowid });
      continue;
    }

    // Participant
    // eslint-disable-next-line no-await-in-loop
    const participantId = await getOrCreateParticipant(knex, row);

    // Event-related normalization only if eventname and eventdatetimestart present
    const eventName = toNullIfBlank(row.eventname);
    const eventStart = parseDate(row.eventdatetimestart);

    let instanceId = null;
    let attendanceId = null;

    if (eventName && eventStart) {
      // eslint-disable-next-line no-await-in-loop
      await getOrCreateEventType(knex, row);
      // eslint-disable-next-line no-await-in-loop
      instanceId = await getOrCreateEventInstance(knex, row);
      // eslint-disable-next-line no-await-in-loop
      attendanceId = await getOrCreateAttendance(knex, participantId, instanceId, row);
      // eslint-disable-next-line no-await-in-loop
      await createSurveyIfNeeded(knex, attendanceId, row);
    } else {
      const reason = !eventName
        ? 'missing eventname (skipped event/attendance/survey)'
        : 'missing or invalid eventdatetimestart (skipped event/attendance/survey)';
      // eslint-disable-next-line no-await-in-loop
      await auditDrop(knex, row, reason);
      console.log('[normalize] Skipping event/attendance/survey for row due to missing event data', {
        rowid: row.rowid,
        eventName,
        eventStartRaw: row.eventdatetimestart,
      });
    }

    // Milestones and donations do not depend on events
    // eslint-disable-next-line no-await-in-loop
    await createMilestonesIfNeeded(knex, participantId, row);
    // eslint-disable-next-line no-await-in-loop
    await createDonationsIfNeeded(knex, participantId, row);

    processedCount += 1;
    console.log('[normalize] Finished row', { rowid: row.rowid, participantId, instanceId, attendanceId });
  }

  console.log('[normalize] Finished per-row normalization', { processedCount, skippedNoEmail });

  // Archive and clear staging table
  console.log('[normalize] Archiving rows into stagingarchive');
  await knex.raw(`
    insert into stagingarchive (
      originalrowid,
      participantemail,
      participantfirstname,
      participantlastname,
      participantdob,
      participantrole,
      participantphone,
      participantcity,
      participantstate,
      participantzip,
      participantschooloremployer,
      participantfieldofinterest,
      eventname,
      eventtype,
      eventdescription,
      eventrecurrencepattern,
      eventdefaultcapacity,
      eventdatetimestart,
      eventdatetimeend,
      eventlocation,
      eventcapacity,
      eventregistrationdeadline,
      registrationstatus,
      registrationattendedflag,
      registrationcheckintime,
      registrationcreatedat,
      surveysatisfactionscore,
      surveyusefulnessscore,
      surveyinstructorscore,
      surveyrecommendationscore,
      surveyoverallscore,
      surveynpsbucket,
      surveycomments,
      surveysubmissiondate,
      milestonetitles,
      milestonedates,
      donationhistory,
      totaldonations
    )
    select
      rowid as originalrowid,
      participantemail,
      participantfirstname,
      participantlastname,
      participantdob,
      participantrole,
      participantphone,
      participantcity,
      participantstate,
      participantzip,
      participantschooloremployer,
      participantfieldofinterest,
      eventname,
      eventtype,
      eventdescription,
      eventrecurrencepattern,
      eventdefaultcapacity,
      eventdatetimestart,
      eventdatetimeend,
      eventlocation,
      eventcapacity,
      eventregistrationdeadline,
      registrationstatus,
      registrationattendedflag,
      registrationcheckintime,
      registrationcreatedat,
      surveysatisfactionscore,
      surveyusefulnessscore,
      surveyinstructorscore,
      surveyrecommendationscore,
      surveyoverallscore,
      surveynpsbucket,
      surveycomments,
      surveysubmissiondate,
      milestonetitles,
      milestonedates,
      donationhistory,
      totaldonations
    from stagingrawsurvey;
  `);

  console.log('[normalize] Truncating stagingrawsurvey');
  await knex.raw('TRUNCATE stagingrawsurvey;');
  console.log('--- Normalization run completed ---');
}

module.exports = runNormalization;
