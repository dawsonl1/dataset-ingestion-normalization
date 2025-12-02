const COLUMN_MAP = {
  ParticipantEmail: 'participantemail',
  ParticipantFirstName: 'participantfirstname',
  ParticipantLastName: 'participantlastname',
  ParticipantDOB: 'participantdob',
  ParticipantRole: 'participantrole',
  ParticipantPhone: 'participantphone',
  ParticipantCity: 'participantcity',
  ParticipantState: 'participantstate',
  ParticipantZip: 'participantzip',
  ParticipantSchoolOrEmployer: 'participantschooloremployer',
  ParticipantFieldOfInterest: 'participantfieldofinterest',
  EventName: 'eventname',
  EventType: 'eventtype',
  EventDescription: 'eventdescription',
  EventRecurrencePattern: 'eventrecurrencepattern',
  EventDefaultCapacity: 'eventdefaultcapacity',
  EventDateTimeStart: 'eventdatetimestart',
  EventDateTimeEnd: 'eventdatetimeend',
  EventLocation: 'eventlocation',
  EventCapacity: 'eventcapacity',
  EventRegistrationDeadline: 'eventregistrationdeadline',
  RegistrationStatus: 'registrationstatus',
  RegistrationAttendedFlag: 'registrationattendedflag',
  RegistrationCheckInTime: 'registrationcheckintime',
  RegistrationCreatedAt: 'registrationcreatedat',
  SurveySatisfactionScore: 'surveysatisfactionscore',
  SurveyUsefulnessScore: 'surveyusefulnessscore',
  SurveyInstructorScore: 'surveyinstructorscore',
  SurveyRecommendationScore: 'surveyrecommendationscore',
  SurveyOverallScore: 'surveyoverallscore',
  SurveyNPSBucket: 'surveynpsbucket',
  SurveyComments: 'surveycomments',
  SurveySubmissionDate: 'surveysubmissiondate',
  MilestoneTitles: 'milestonetitles',
  MilestoneDates: 'milestonedates',
  DonationHistory: 'donationhistory',
  TotalDonations: 'totaldonations',
};

// Some tools (e.g. Excel) can prefix the first header with a BOM (\uFEFF), so
// we normalize header keys before mapping so ParticipantEmail is picked up
// correctly even if the raw header contains hidden characters.
function normalizeHeaderKey(key) {
  if (!key) return key;
  return key.replace(/^\uFEFF/, '').trim();
}

function mapRow(rawRow) {
  const normalized = {};

  // Build a normalized view of the row keyed by cleaned header names
  for (const [key, value] of Object.entries(rawRow)) {
    const cleanKey = normalizeHeaderKey(key);
    normalized[cleanKey] = value;
  }

  const mapped = {};

  for (const [csvKey, dbColumn] of Object.entries(COLUMN_MAP)) {
    const value = normalized[csvKey];
    mapped[dbColumn] = value === undefined ? null : String(value);
  }

  return mapped;
}

async function mapCsvRowsToStaging(knex, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  console.log('[staging] Starting CSV -> staging load', { rowCount: rows.length });

  const mappedRows = rows.map((row, index) => {
    const mapped = mapRow(row);
    if (index < 3) {
      // Log a small sample of the first few mapped rows for debugging
      console.log('[staging] Sample mapped row', { index, mapped });
    }
    return mapped;
  });

  // Insert in batches to avoid very large single INSERTs
  const BATCH_SIZE = 500;
  for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
    const batch = mappedRows.slice(i, i + BATCH_SIZE);
    // All columns in stagingrawsurvey are TEXT, so no transformation here
    // We deliberately do not validate/clean anything at this stage.
    console.log('[staging] Inserting batch into stagingrawsurvey', {
      batchIndex: i / BATCH_SIZE,
      batchSize: batch.length,
    });
    // eslint-disable-next-line no-await-in-loop
    await knex('stagingrawsurvey').insert(batch);
  }

  console.log('[staging] Completed CSV -> staging load');
}

module.exports = mapCsvRowsToStaging;
