const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: "exovon-server-managed",
  baseURL: "http://localhost:9002/api/ai/google",
  httpOptions: {
    baseUrl: "http://localhost:9002/api/ai/google",
    headers: {
      "Authorization": "Bearer exo_live_test123"
    }
  }
});

ai.models.generateContent({
  model: "gemma-4-31b-it",
  contents: "Hello"
}).then(res => console.log(res.text)).catch(err => console.error("ERR:", err.message));
