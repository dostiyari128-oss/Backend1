// index.js

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const { v4: uuidv4 } = require('uuid'); // To generate unique IDs

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// --- In-memory storage for the hackathon ---
// In a real app, you'd use a database like Supabase or Firebase.
// This object will store the analysis results temporarily.
const analysisResults = {};

// --- Middleware ---
app.use(cors()); // Allow requests from your frontend
app.use(express.json());

// Set up multer for file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Initialize Gemini AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- API Endpoints ---

// This is the main endpoint your frontend will call
app.post('/api/analyze', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    // 1. Extract text from the uploaded PDF
    const data = await pdf(req.file.buffer);
    const documentText = data.text;

    // 2. Prepare the prompt for Gemini
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
      "summary", "risky_clauses", and "explanations".
    `;

    // 3. Call the Gemini API
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const analysisText = response.text();

    // 4. Store the result and generate a unique ID
    const doc_id = uuidv4();
    analysisResults[doc_id] = JSON.parse(analysisText); // Store the parsed JSON

    console.log(`Analysis complete for doc_id: ${doc_id}`);

    // 5. Send the unique ID back to the frontend
    res.status(200).json({ doc_id: doc_id });

  } catch (error) {
    console.error('Error during analysis:', error);
    res.status(500).json({ error: 'Failed to analyze document.' });
  }
});

// This endpoint lets the frontend fetch the results using the ID
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
