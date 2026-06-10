const fs = require('fs');
const pdfParse = require('pdf-parse');

async function testParse() {
  try {
    const dataBuffer = fs.readFileSync('../Terembérlet.pdf');
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text;

    console.log('--- Kinyert szöveg ---');
    console.log(text.substring(0, 500) + '...\n'); // Print some text to see what it looks like

    const regex = /(Végösszeg|Fizetendő|Összesen)\s*:?\s*([\d\s\.]+)\s*(Ft|HUF)/i;
    const match = regex.exec(text);

    let amount = null;
    if (match) {
      const amountStr = match[2].replace(/[\s\xa0\.]/g, '');
      amount = parseInt(amountStr, 10);
      console.log(`✅ Sikeres regex találat: ${amount} Ft`);
    } else {
      console.log('❌ Nem talált a regex!');
      
      // Fallback
      const altRegex = /(?<!\d)([\d\s\.]+)\s*(Ft|HUF)/ig;
      let altMatch;
      let lastAltMatch = null;
      while ((altMatch = altRegex.exec(text)) !== null) {
        lastAltMatch = altMatch;
      }
      if (lastAltMatch) {
        const amountStr = lastAltMatch[1].replace(/[\s\xa0\.]/g, '');
        amount = parseInt(amountStr, 10);
        console.log(`✅ Sikeres FALLBACK találat: ${amount} Ft`);
      } else {
        console.log('❌ A fallback sem talált összeget!');
      }
    }
  } catch (err) {
    console.error('Hiba a tesztelés során:', err);
  }
}

testParse();
