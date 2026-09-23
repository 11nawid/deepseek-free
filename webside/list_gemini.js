const key = process.argv[2];

if (!key) {
  console.error("❌ Please provide your Gemini API key.");
  console.error("Usage: node list_gemini.js <YOUR_API_KEY>");
  process.exit(1);
}

console.log("Fetching available Gemini models for your key...\n");

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      console.error("❌ API Error:", data.error.message);
      return;
    }

    // Filter for models that support generating content (chat)
    const validModels = data.models.filter(m => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
    );

    console.log("✅ AVAILABLE MODELS FOR YOUR KEY:");
    console.log("-------------------------------------------------");
    validModels.forEach(m => {
      // Print the exact string to use in the Settings UI (removing the "models/" prefix)
      const nameToUse = m.name.replace("models/", "");
      console.log(`Model Name:  ${nameToUse}`);
      console.log(`Description: ${m.description || "N/A"}`);
      console.log("-------------------------------------------------");
    });
    
    console.log("\n💡 Copy one of the 'Model Name' values above and paste it into the app's Settings UI!");
  })
  .catch(err => {
    console.error("❌ Failed to fetch:", err.message);
  });
