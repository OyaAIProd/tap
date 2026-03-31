/**
 * Bottom-up performance analysis
 * Analyze cost and frequency of each primitive operation
 */

// Kernel (8 primitives) + Stdlib (16 operations) cost analysis
const operations = [
  // KERNEL PRIMITIVES
  {
    name: "eval",
    type: "kernel",
    costMs: 1,
    frequency: "high",
    description: "Execute JS in page context",
    rationale: "Very fast locally, but RPC overhead if called many times",
  },
  {
    name: "pointer",
    type: "kernel",
    costMs: 2,
    frequency: "high",
    description: "Send mouse event via CDP",
    rationale: "CDP round-trip, but necessary for interaction",
  },
  {
    name: "keyboard",
    type: "kernel",
    costMs: 2,
    frequency: "medium",
    description: "Send keyboard event via CDP",
    rationale: "Similar to pointer, CDP latency",
  },
  {
    name: "nav",
    type: "kernel",
    costMs: 200,
    frequency: "low",
    description: "Navigate to URL",
    rationale: "Network + page load, unavoidable but highest single cost",
  },
  {
    name: "wait",
    type: "kernel",
    costMs: 0.5,
    frequency: "medium",
    description: "Wait for time or condition",
    rationale: "Usually MutationObserver (efficient), but can add up",
  },
  {
    name: "screenshot",
    type: "kernel",
    costMs: 50,
    frequency: "low",
    description: "Capture page image",
    rationale: "Heavy operation, rarely used in taps",
  },
  {
    name: "tap",
    type: "kernel",
    costMs: 100,
    frequency: "low",
    description: "Call another tap",
    rationale: "Recursive execution, depends on sub-tap cost",
  },
  {
    name: "capabilities",
    type: "kernel",
    costMs: 1,
    frequency: "very-low",
    description: "Declare runtime capabilities",
    rationale: "Metadata only, called at start",
  },

  // STDLIB (16 operations)
  {
    name: "click",
    type: "stdlib",
    costMs: 3,
    frequency: "very-high",
    description: "Find element + click",
    rationale: "Composed: find(text) + pointer(x,y). Find is slow!",
  },
  {
    name: "type",
    type: "stdlib",
    costMs: 2,
    frequency: "high",
    description: "Focus + send key events",
    rationale: "Multiple keyboard events if text is long",
  },
  {
    name: "fill",
    type: "stdlib",
    costMs: 1,
    frequency: "high",
    description: "Set input value directly",
    rationale: "Faster than type (no char-by-char), but CDP path",
  },
  {
    name: "hover",
    type: "stdlib",
    costMs: 2,
    frequency: "medium",
    description: "Move mouse to element",
    rationale: "Similar to click, but no actual click",
  },
  {
    name: "scroll",
    type: "stdlib",
    costMs: 2,
    frequency: "medium",
    description: "Scroll element into view",
    rationale: "Viewport calculation + optional animation",
  },
  {
    name: "pressKey",
    type: "stdlib",
    costMs: 1,
    frequency: "high",
    description: "Press single key (Enter, Space, etc)",
    rationale: "Single CDP event",
  },
  {
    name: "select",
    type: "stdlib",
    costMs: 2,
    frequency: "low",
    description: "Select dropdown option",
    rationale: "Find option + click, or direct value set",
  },
  {
    name: "upload",
    type: "stdlib",
    costMs: 50,
    frequency: "very-low",
    description: "Upload file to input",
    rationale: "File IO + CDP, expensive but rare",
  },
  {
    name: "dialog",
    type: "stdlib",
    costMs: 1,
    frequency: "low",
    description: "Handle alert/confirm",
    rationale: "Simple CDP command",
  },
  {
    name: "fetch",
    type: "stdlib",
    costMs: 150,
    frequency: "medium",
    description: "API request with session",
    rationale: "Network overhead, can be cached",
  },
  {
    name: "find",
    type: "stdlib",
    costMs: 5,
    frequency: "very-high",
    description: "Find element by text",
    rationale: "DOM traversal + accessibility tree, called by click/hover/type",
  },
  {
    name: "cookies",
    type: "stdlib",
    costMs: 1,
    frequency: "very-low",
    description: "Get session cookies",
    rationale: "Single eval call",
  },
  {
    name: "download",
    type: "stdlib",
    costMs: 100,
    frequency: "very-low",
    description: "Download and parse response",
    rationale: "Network + file IO",
  },
  {
    name: "waitFor",
    type: "stdlib",
    costMs: 50,
    frequency: "medium",
    description: "Wait for element",
    rationale: "MutationObserver is efficient, but timeout can be 5000ms",
  },
  {
    name: "waitForNetwork",
    type: "stdlib",
    costMs: 100,
    frequency: "low",
    description: "Wait for network idle",
    rationale: "Can be slow on slow networks",
  },
  {
    name: "ssrState",
    type: "stdlib",
    costMs: 2,
    frequency: "low",
    description: "Extract SSR globals",
    rationale: "Single eval call",
  },
  {
    name: "storage",
    type: "stdlib",
    costMs: 1,
    frequency: "very-low",
    description: "Read local/session storage",
    rationale: "Single eval call",
  },
];

console.log("\n=== BOTTOM-UP OPERATION ANALYSIS ===\n");

// Group by frequency
const byFrequency = {
  "very-high": operations.filter(o => o.frequency === "very-high"),
  high: operations.filter(o => o.frequency === "high"),
  medium: operations.filter(o => o.frequency === "medium"),
  low: operations.filter(o => o.frequency === "low"),
  "very-low": operations.filter(o => o.frequency === "very-low"),
};

console.log("📊 VERY-HIGH FREQUENCY (called 100+ times per tap):\n");
for (const op of byFrequency["very-high"]) {
  console.log(
    `  ${op.name.padEnd(20)} ${op.costMs}ms  | ${op.description}`,
  );
  console.log(`  → ${op.rationale}\n`);
}

console.log("📊 HIGH FREQUENCY (called 10-100 times per tap):\n");
for (const op of byFrequency.high) {
  console.log(
    `  ${op.name.padEnd(20)} ${op.costMs}ms  | ${op.description}`,
  );
  console.log(`  → ${op.rationale}\n`);
}

console.log("📊 MEDIUM FREQUENCY (called 1-10 times per tap):\n");
for (const op of byFrequency.medium) {
  console.log(
    `  ${op.name.padEnd(20)} ${op.costMs}ms  | ${op.description}`,
  );
  console.log(`  → ${op.rationale}\n`);
}

console.log("📊 LOW FREQUENCY (rarely called):\n");
for (const op of byFrequency.low.concat(byFrequency["very-low"])) {
  console.log(
    `  ${op.name.padEnd(20)} ${op.costMs}ms  | ${op.description}`,
  );
  console.log(`  → ${op.rationale}\n`);
}

// Calculate potential optimization impact
console.log("\n=== OPTIMIZATION ROI MATRIX ===\n");

const optimizationCandidates = [
  {
    name: "Find result caching",
    affects: ["find", "click", "hover", "type"],
    costPerCall: 5,
    frequency: "very-high",
    callsPerTap: 50,
    cacheHitRate: 0.3,
    optimizationSavings: 5 * 50 * 0.3, // 75ms per tap!
    effort: "2-3h",
    complexity: "low",
    risk: "very-low",
  },
  {
    name: "Pointer batch optimization",
    affects: ["pointer", "click"],
    costPerCall: 2,
    frequency: "very-high",
    callsPerTap: 20,
    optimizationPercent: 0.2,
    optimizationSavings: 2 * 20 * 0.2, // 8ms per tap
    effort: "2-3h",
    complexity: "low",
    risk: "low",
  },
  {
    name: "Find debouncing",
    affects: ["find"],
    costPerCall: 5,
    frequency: "very-high",
    callsPerTap: 50,
    optimizationPercent: 0.1,
    optimizationSavings: 5 * 50 * 0.1, // 25ms per tap
    effort: "1-2h",
    complexity: "low",
    risk: "medium",
  },
  {
    name: "WaitFor timeout tuning",
    affects: ["waitFor"],
    costPerCall: 50,
    frequency: "medium",
    callsPerTap: 3,
    optimizationPercent: 0.3,
    optimizationSavings: 50 * 3 * 0.3, // 45ms per tap (if defaults too high)
    effort: "1h",
    complexity: "very-low",
    risk: "medium",
  },
  {
    name: "Fetch connection pooling",
    affects: ["fetch"],
    costPerCall: 150,
    frequency: "medium",
    callsPerTap: 2,
    optimizationPercent: 0.4,
    optimizationSavings: 150 * 2 * 0.4, // 120ms per tap
    effort: "3-5h",
    complexity: "medium",
    risk: "medium",
  },
  {
    name: "Keyboard event batching",
    affects: ["keyboard", "type"],
    costPerCall: 1,
    frequency: "high",
    callsPerTap: 100,
    optimizationPercent: 0.3,
    optimizationSavings: 1 * 100 * 0.3, // 30ms per tap
    effort: "2-3h",
    complexity: "low",
    risk: "low",
  },
  {
    name: "Click optimization (reuse find result)",
    affects: ["click"],
    costPerCall: 3,
    frequency: "very-high",
    callsPerTap: 20,
    optimizationPercent: 0.5,
    optimizationSavings: 3 * 20 * 0.5, // 30ms per tap
    effort: "1-2h",
    complexity: "low",
    risk: "very-low",
  },
];

// Sort by savings/effort ratio
const sorted = optimizationCandidates.sort((a, b) => {
  const effortA = parseInt(a.effort.split("-")[1]);
  const effortB = parseInt(b.effort.split("-")[1]);
  return (b.optimizationSavings / effortB) - (a.optimizationSavings / effortA);
});

console.log("Sorted by ROI (savings per hour):\n");
for (const opt of sorted) {
  const effortHours = parseInt(opt.effort.split("-")[1]);
  const roi = (opt.optimizationSavings / effortHours).toFixed(1);
  const complexity = opt.complexity.padEnd(10);
  const risk = opt.risk.padEnd(10);

  console.log(`🎯 ${opt.name}`);
  console.log(`   Savings: ${opt.optimizationSavings.toFixed(0)}ms/tap | Effort: ${opt.effort} | ROI: ${roi}ms/h`);
  console.log(`   Complexity: ${complexity} | Risk: ${risk}`);
  console.log(`   Affects: ${opt.affects.join(", ")}\n`);
}

console.log("\n=== RECOMMENDED ORDER ===\n");
console.log("1. Find result caching");
console.log("   → Saves 75ms per tap (if 30% cache hit)");
console.log("   → Find is called by click, hover, type (all very-high frequency)");
console.log("   → Risk: very-low, Effort: 2-3h\n");

console.log("2. Click optimization");
console.log("   → Reuse find result from cache");
console.log("   → Saves 30ms per tap");
console.log("   → Risk: very-low, Effort: 1-2h\n");

console.log("3. Fetch connection pooling");
console.log("   → Saves 120ms per tap (reuse connection)");
console.log("   → Risk: medium, Effort: 3-5h");
console.log("   → Note: Network layer improvement\n");

console.log("4. Keyboard event batching");
console.log("   → Saves 30ms per tap");
console.log("   → Batch consecutive key presses");
console.log("   → Risk: low, Effort: 2-3h\n");

console.log("5. WaitFor timeout tuning");
console.log("   → Analyze if 5000ms default is too conservative");
console.log("   → Potential 45ms savings");
console.log("   → Risk: medium (may miss elements)\n");

console.log("6. Pointer batch optimization");
console.log("   → Combine consecutive pointer events");
console.log("   → Saves 8ms (small)");
console.log("   → Risk: low, Effort: 2-3h\n");

console.log("7. Find debouncing");
console.log("   → Skip redundant find calls");
console.log("   → Saves 25ms");
console.log("   → Risk: medium (may detect stale elements)\n");

console.log("\n=== TOTAL POTENTIAL IMPACT ===\n");
const totalSavings = sorted.reduce((sum, opt) => sum + opt.optimizationSavings, 0);
const totalEffort = sorted.reduce((sum, opt) => {
  const hours = parseInt(opt.effort.split("-")[1]);
  return sum + hours;
}, 0);

console.log(`Total potential savings: ${totalSavings.toFixed(0)}ms per tap`);
console.log(`Total effort: ${totalEffort} hours`);
console.log(`Average per tap: ${(totalSavings / sorted.length).toFixed(0)}ms`);
console.log(`\nFor a 400ms tap, this is ${((totalSavings / 400) * 100).toFixed(1)}% speedup`);
console.log(`For 4 weeks of work, estimated impact: 20-30% total speedup\n`);
