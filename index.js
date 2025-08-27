// index.js

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const mammoth = require('mammoth'); // <-- NEW: Add mammoth for DOCX
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const analysisResults = {};

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/analyze', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    let documentText = '';

    // --- NEW: Check the file type and process accordingly ---
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer);
      documentText = data.text;
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
      documentText = value;
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or DOCX.' });
    }
    
    if (!documentText) {
        return res.status(400).json({ error: 'Could not extract text from the document.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });
    const prompt = `
      You are an expert legal assistant specialized in Indian law. 
      Analyze the following legal document text. Provide a clear, simple summary, 
      identify any potentially risky or unfavorable clauses for the user, 
      and explain them in plain English.

      Document Text:
      ---
      ${documentText}
      ---

      Please provide the analysis in a structured JSON format with three keys: 
      "summary", "risky_clauses", and "explanations". The "risky_clauses" should be an array of objects, where each object has "title", "source_excerpt", "explanation_en", and "risk_level" (LOW, MEDIUM, or HIGH).
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let analysisText = response.text();
    
    // Clean the response to ensure it's valid JSON
    analysisText = analysisText.replace(/```json/g, '').replace(/```/g, '').trim();

    const doc_id = uuidv4();
    analysisResults[doc_id] = JSON.parse(analysisText);

    console.log(`Analysis complete for doc_id: ${doc_id}`);
    res.status(200).json({ doc_id: doc_id });

  } catch (error) {
    console.error('Error during analysis:', error);
    res.status(500).json({ error: 'Failed to analyze document.' });
  }
});

app.get('/api/results/:doc_id', (req, res) => {
    const { doc_id } = req.params;
    const result = analysisResults[doc_id];
    if (result) {
        res.status(200).json(result);
    } else {
        res.status(404).json({ error: 'Analysis not found.' });
    }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
