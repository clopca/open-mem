# 10. AI Compressor

## Meta
- **ID**: open-mem-10
- **Feature**: open-mem
- **Phase**: 3
- **Priority**: P1
- **Depends On**: [open-mem-02, open-mem-09]
- **Effort**: M (2-3h)
- **Tags**: [implementation, ai, compression, anthropic]
- **Requires UX/DX Review**: false

## Objective
Implement the AI observation compressor that takes raw tool output and produces structured observations using the Anthropic API.

## Context
When a tool executes in OpenCode, the raw output can be verbose (file contents, command output, etc.). The compressor sends this to Claude via the Anthropic API with the compression prompt template, then parses the structured XML response into an Observation object. This is the core AI pipeline component.

**User Requirements**: AI-powered compression of observations. Direct Anthropic API (not claude-agent-sdk).

## Deliverables
- `src/ai/compressor.ts` — AI observation compression using Anthropic Messages API

## Implementation Steps

### Step 1: Create Anthropic client wrapper
```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { OpenMemConfig, Observation } from "../types";
import { buildCompressionPrompt } from "./prompts";
import { parseObservationResponse, estimateTokens } from "./parser";
import type { ParsedObservation } from "./parser";

export class ObservationCompressor {
  private client: Anthropic;
  private config: OpenMemConfig;
  
  constructor(config: OpenMemConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }
}
```

### Step 2: Implement compression method
```typescript
async compress(
  toolName: string,
  toolOutput: string,
  sessionId: string,
  sessionContext?: string
): Promise<ParsedObservation | null> {
  if (!this.config.compressionEnabled) {
    return null;
  }
  
  // Skip if output is too short to be meaningful
  if (toolOutput.length < this.config.minOutputLength) {
    return null;
  }
  
  // Truncate very long outputs to avoid excessive API costs
  const maxInputLength = 50_000;  // ~12.5K tokens
  const truncatedOutput = toolOutput.length > maxInputLength
    ? toolOutput.substring(0, maxInputLength) + "\n\n[... truncated ...]"
    : toolOutput;
  
  const prompt = buildCompressionPrompt(toolName, truncatedOutput, sessionContext);
  
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokensPerCompression,
        messages: [
          { role: "user", content: prompt },
        ],
      });
      
      // Extract text from response
      const text = response.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("");
      
      const parsed = parseObservationResponse(text);
      if (!parsed) {
        console.warn("[open-mem] Failed to parse compression response for tool:", toolName);
        return null;
      }
      
      return parsed;
    } catch (error: any) {
      const isRetryable = error?.status === 429 || error?.status === 500 || error?.status === 503 || error?.error?.type === 'overloaded_error';
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
        console.warn(`[open-mem] Retryable API error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      console.error("[open-mem] Compression API error:", error);
      return null;
    }
  }
  return null;
}
```

### Step 3: Implement batch compression
```typescript
async compressBatch(
  items: Array<{
    toolName: string;
    toolOutput: string;
    sessionId: string;
    callId: string;
  }>,
  sessionContext?: string
): Promise<Map<string, ParsedObservation | null>> {
  const results = new Map<string, ParsedObservation | null>();
  
  // Process sequentially to avoid rate limits
  // Could be parallelized with rate limiting in the future
  for (const item of items) {
    const result = await this.compress(
      item.toolName,
      item.toolOutput,
      item.sessionId,
      sessionContext
    );
    results.set(item.callId, result);
    
    // Small delay between API calls to be respectful
    if (items.indexOf(item) < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}
```

### Step 4: Implement fallback for when AI is unavailable
```typescript
// Create a basic observation without AI compression
createFallbackObservation(
  toolName: string,
  toolOutput: string,
): ParsedObservation {
  // Extract file paths from output using simple heuristics
  const filePathRegex = /(?:^|\s)((?:\.\/|\/|src\/|tests\/)\S+\.\w+)/gm;
  const filePaths: string[] = [];
  let match;
  while ((match = filePathRegex.exec(toolOutput)) !== null) {
    filePaths.push(match[1]);
  }
  
  // Determine type based on tool name
  const typeMap: Record<string, string> = {
    "Read": "discovery",
    "Write": "change",
    "Edit": "change",
    "Bash": "change",
    "Glob": "discovery",
    "Grep": "discovery",
  };
  
  const type = (typeMap[toolName] || "discovery") as any;
  
  return {
    type,
    title: `${toolName} execution`,
    subtitle: toolOutput.substring(0, 100).replace(/\n/g, " "),
    facts: [],
    narrative: `Tool ${toolName} was executed. Output length: ${toolOutput.length} chars.`,
    concepts: [],
    filesRead: type === "discovery" ? filePaths : [],
    filesModified: type === "change" ? filePaths : [],
  };
}
```

### Step 5: Add health check method
```typescript
async isAvailable(): Promise<boolean> {
  if (!this.config.apiKey) return false;
  
  try {
    // Minimal API call to verify connectivity
    await this.client.messages.create({
      model: this.config.model,
      max_tokens: 10,
      messages: [{ role: "user", content: "ping" }],
    });
    return true;
  } catch {
    return false;
  }
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/ai/compressor.ts` | Create | ObservationCompressor class with compress, compressBatch, fallback, health check |

## Acceptance Criteria
- [ ] `src/ai/compressor.ts` exports `ObservationCompressor` class
- [ ] `compress()` sends tool output to Anthropic API with compression prompt
- [ ] `compress()` parses XML response into ParsedObservation
- [ ] `compress()` returns null for outputs shorter than minOutputLength
- [ ] `compress()` truncates very long outputs to prevent excessive API costs
- [ ] `compress()` handles API errors gracefully (returns null, logs error)
- [ ] `compress()` retries on transient API errors (429, 500, 503) with exponential backoff
- [ ] `compressBatch()` processes multiple items sequentially with delay
- [ ] `createFallbackObservation()` creates basic observation without AI
- [ ] Fallback extracts file paths from output using regex heuristics
- [ ] Fallback determines observation type from tool name
- [ ] `isAvailable()` checks API connectivity
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Test fallback (no API key needed)
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { ObservationCompressor } = require('./src/ai/compressor.ts');
  const compressor = new ObservationCompressor({
    compressionEnabled: false,
    apiKey: undefined,
    model: 'claude-sonnet-4-20250514',
    maxTokensPerCompression: 1024,
    minOutputLength: 50,
  });
  const fallback = compressor.createFallbackObservation('Read', 'Contents of src/auth.ts:\nexport function login() { ... }');
  console.log('Fallback:', JSON.stringify(fallback, null, 2));
"
```

## Notes
- The Anthropic SDK handles API key from constructor or `ANTHROPIC_API_KEY` env var
- Rate limiting is handled simply with sequential processing + delay — for v1 this is sufficient
- The fallback mechanism ensures observations are still captured even without AI compression
- Retry logic with exponential backoff is included for transient errors (429, 500, 503).
- The `maxInputLength` of 50K chars (~12.5K tokens) prevents excessive API costs for very large tool outputs
- In production, consider using Anthropic's batch API for cost savings
