const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');

const knex = require('./util/db');
const runNormalization = require('./etl/normalize');
const mapCsvRowsToStaging = require('./etl/mapCsvToStaging');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));

// Configure Multer to store uploaded CSV files temporarily on disk
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Home page: render single-page upload form
app.get('/', (req, res) => {
  res.render('upload', { message: null, error: null });
});

// Upload endpoint: accept CSV, stream rows into staging table, then normalize
app.post('/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).render('upload', { message: null, error: 'No file uploaded. Please choose a CSV file.' });
  }

  const filePath = req.file.path;

  const rows = [];

  try {
    console.log('--- Upload started ---');
    console.log('[upload] Received file', { originalname: req.file.originalname, size: req.file.size, path: filePath });
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          rows.push(data);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log('[upload] Finished reading CSV file', { rowCount: rows.length });

    // Insert all raw rows into staging table
    await mapCsvRowsToStaging(knex, rows);

    // Run the normalization pipeline (staging -> normalized tables + archive)
    await runNormalization(knex);

    // Optionally remove the temporary file
    fs.unlink(filePath, () => {});

    console.log('--- Upload + normalization completed successfully ---');
    res.render('upload', { message: 'Upload and normalization completed successfully.', error: null });
  } catch (err) {
    console.error('Error during upload/normalization:', err);
    fs.unlink(filePath, () => {});
    res.status(500).render('upload', { message: null, error: 'An error occurred while processing the CSV. Check server logs for details.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
