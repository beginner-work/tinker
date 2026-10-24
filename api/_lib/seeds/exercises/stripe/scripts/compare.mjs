console.log("=== Stripe webhook scale compare ===");
console.log("1. npm run baseline  && npm run burst");
console.log("2. npm run better    && BETTER=1 npm run burst");
console.log("3. npm run test:idempotency");
console.log("Better must print duplicates_applied=0 after burst replay.");
