// index.js

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
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
      ${documentText.substring(0, 30000)} 
      ---

      IMPORTANT: You must provide the analysis in a single, valid JSON object format with three keys: 
      "summary", "risky_clauses", and "explanations". The "risky_clauses" must be an array of objects, where each object has "title", "source_excerpt", "explanation_en", and "risk_level" (LOW, MEDIUM, or HIGH). Do not wrap the JSON in markdown backticks.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let analysisText = response.text();
    
    // --- NEW: More robust JSON cleaning and parsing ---
    let analysisJSON;
    try {
      // First, try to find the JSON block in case the AI adds extra text
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisJSON = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No valid JSON object found in the AI response.");
      }
    } catch (parseError) {
      // If parsing fails, log the problematic text and send an error
      console.error("--- FAILED TO PARSE GEMINI RESPONSE ---");
      console.error("Problematic text received:", analysisText);
      // This specific error helps with debugging
      throw new Error("The AI model returned an invalid or unexpected format."); 
    }

    const doc_id = uuidv4();
    analysisResults[doc_id] = analysisJSON; // Store the valid JSON

    console.log(`Analysis complete for doc_id: ${doc_id}`);
    res.status(200).json({ doc_id: doc_id });

  } catch (error) {
    console.error('Error during analysis:', error);
    // Send a more specific error message back to the frontend
    res.status(500).json({ error: error.message || 'Failed to analyze document.' });
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
