const { checkScripts } = require('./crawler');

// Test crawlera
async function test() {
  console.log('🧪 Test crawlera\n');
  
  // Testuj na przykładowej stronie
  const result = await checkScripts('https://example.com');
  
  console.log('\n📊 Wyniki:');
  console.log(JSON.stringify(result, null, 2));
}

test();