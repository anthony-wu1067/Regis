# Regis AI Team Architecture

## Purpose

Regis should evolve from having several AI personas that can chat into having persistent, specialized AI teams that behave like software organizations.

The key distinction is:

- A **Team** is an organizational unit with a mission.
- A **Lead** manages the team and coordinates work.
- A **Specialist** performs a narrow type of work.
- A **Tool** gives an agent the ability to interact with something.
- A **Workflow** defines a repeatable process.
- A **Plugin** adds capabilities to Regis without requiring core Regis code to be rewritten.
- A **Model/Engine** provides reasoning ability.
- **Memory** stores persistent knowledge.
- **Policy** determines when models/tools/actions may be used.

Claude is NOT the AI team.

Claude is one reasoning engine that a team may use when a task requires it.

Local AI is another reasoning engine and should handle as much simple work as possible to minimize API cost.

---

# 1. Core Architecture

The architecture should follow:

```text
TEAM
 ├── Mission
 ├── Lead
 │    └── Orchestrates work
 │
 ├── Specialists
 │    ├── Researcher
 │    ├── Analyst
 │    ├── Writer
 │    └── Other domain experts
 │
 ├── Tools
 │    ├── Web
 │    ├── Files
 │    ├── Email
 │    ├── Calendar
 │    └── External services
 │
 ├── Workflows
 │    ├── Scheduled
 │    ├── Triggered
 │    └── Manual
 │
 ├── Knowledge
 │
 ├── Memory
 │
 ├── KPIs
 │
 └── Policy
      ├── Model routing
      ├── Budget
      ├── Permissions
      └── Approval rules
```

The important architectural rule is:

> Teams should own capabilities and processes rather than simply owning prompts.

---

# 2. Team Object

A team should be represented as a persistent object.

Example:

```js
{
  id: "marketing",
  name: "Marketing Team",

  mission:
    "Grow awareness, acquisition, and retention for the business.",

  lead: {
    agentId: "marketing-lead"
  },

  specialists: [
    "market-research",
    "copywriter",
    "analytics"
  ],

  tools: [
    "web-search",
    "documents",
    "email"
  ],

  workflows: [
    "weekly-market-scan",
    "campaign-review"
  ],

  knowledge: [
    "brand-guidelines",
    "customer-personas"
  ],

  memory: {
    scope: "marketing"
  },

  kpis: [],

  policy: {
    defaultEngine: "local",
    complexEngine: "claude",
    maxClaudeCallsPerTask: 3,
    requireApprovalForExternalWrites: true
  }
}
```

Do not require every field to be populated.

Teams should work with minimal configuration and become more capable as plugins are installed.

---

# 3. Agent Types

Agents should no longer simply be interchangeable personas.

There should be at least two conceptual agent types.

## Lead

A Lead is responsible for:

1. Understanding the incoming task.
2. Determining whether it belongs to the team.
3. Breaking complex tasks into subtasks.
4. Selecting specialists.
5. Selecting tools.
6. Selecting the appropriate model.
7. Assigning work.
8. Reviewing results.
9. Requesting additional work when necessary.
10. Producing the final result.
11. Recording important information in team memory.

The lead should NOT automatically perform every task itself.

Its primary role is orchestration.

---

## Specialist

A specialist has a narrower responsibility.

Example:

```js
{
  id: "market-research",
  team: "marketing",
  type: "specialist",

  role: "Market Research Specialist",

  instructions:
    "Research competitors, market trends, customer behavior, and relevant industry information.",

  capabilities: [
    "research",
    "summarize",
    "classify"
  ]
}
```

Specialists should be reusable.

A specialist should be able to operate through the team's orchestration system rather than existing only as a chat persona.

---

# 4. Lead Orchestration Loop

A lead should conceptually follow this process:

```text
RECEIVE TASK
      ↓
UNDERSTAND TASK
      ↓
CLASSIFY COMPLEXITY
      ↓
DETERMINE REQUIRED CAPABILITIES
      ↓
CREATE PLAN
      ↓
DELEGATE SUBTASKS
      ↓
EXECUTE
      ↓
CHECK RESULTS
      ↓
REVISE / DELEGATE AGAIN IF NECESSARY
      ↓
FINALIZE
      ↓
STORE IMPORTANT MEMORY
```

For example:

User:

> "Find out why our competitor's sales appear to be increasing and tell me what we should do."

The lead might determine:

```text
1. Research competitor
2. Gather relevant market information
3. Analyze changes
4. Compare against our business
5. Generate strategic recommendations
```

It could delegate:

```text
Researcher → information gathering
Analyst → quantitative/competitive analysis
Lead → synthesis and recommendation
```

The lead should not blindly delegate every task. Simple tasks should be handled directly when appropriate.

---

# 5. Model Routing

Regis should have a model router outside the model itself.

Do NOT allow the AI to freely decide whether to spend money.

The application should enforce routing policy.

Conceptual complexity levels:

```text
LEVEL 0
Direct deterministic tool/action

LEVEL 1
Local AI

LEVEL 2
Local AI + tools

LEVEL 3
Local AI + specialist

LEVEL 4
Multiple specialists

LEVEL 5
Claude / advanced reasoning workflow
```

Examples of tasks that should normally remain local:

- Classification
- Extraction
- Formatting
- Summarization
- Categorization
- Simple calculations
- Task routing
- Task management
- Change detection
- Basic drafting
- Structured data transformation
- Simple tool selection

Examples that may justify Claude:

- Complex strategic reasoning
- Ambiguous research questions
- Difficult synthesis
- Multi-source analysis
- High-value business decisions
- Complex planning
- Tasks where local model confidence is low
- Tasks explicitly requested to use Claude

The router should make this decision before making a Claude API call.

---

# 6. Claude Cost Control

Claude usage must be treated as a scarce resource.

Every Claude call should be tracked.

Track at minimum:

```js
{
  teamId,
  taskId,
  timestamp,
  model,
  inputTokens,
  outputTokens,
  estimatedCost
}
```

Teams should support policies such as:

```js
{
  defaultEngine: "local",

  complexEngine: "claude",

  maxClaudeCallsPerTask: 3,

  maxDailyClaudeCost: 5,

  escalationPolicy: "when-needed"
}
```

Possible escalation policies:

```text
local-only
never-automatic
when-needed
claude-preferred
claude-only
```

The system must prevent a runaway loop where a Lead repeatedly calls Claude.

Hard limits should exist at the application level.

---

# 7. Confidence / Escalation

The local model should not be expected to solve everything.

Instead, Regis should support escalation.

Example:

```text
Task arrives
     ↓
Local AI evaluates task
     ↓
Simple?
 ├── YES → Local AI
 └── NO
       ↓
Can local AI complete with tools?
 ├── YES → Local AI + tools
 └── NO
       ↓
Is this within Claude policy?
 ├── YES → Claude
 └── NO → Ask user / fail safely
```

Do not rely solely on the model saying "I am not confident."

Use application-level rules where possible.

---

# 8. Team Memory

Conversation history and team memory are different.

Conversation history:

> What was recently said.

Team memory:

> What the team has learned and should remember.

Team memory may contain:

- Decisions
- Important facts
- Customer information
- Competitors
- Lessons learned
- Preferences
- Business rules
- Previous analyses
- Important documents
- Successful workflows

Memory should be scoped by team.

Example:

```text
Marketing Team
 └── Marketing Memory

Finance Team
 └── Finance Memory

Operations Team
 └── Operations Memory
```

A team should not automatically have access to every other team's memory.

---

# 9. Workflows

Workflows are repeatable processes.

A workflow should be represented as structured data rather than merely a prompt.

Example:

```js
{
  id: "weekly-market-scan",

  teamId: "marketing",

  trigger: {
    type: "schedule",
    schedule: "weekly"
  },

  steps: [
    {
      type: "research",
      specialist: "market-research"
    },
    {
      type: "analyze",
      specialist: "analytics"
    },
    {
      type: "review",
      agent: "marketing-lead"
    },
    {
      type: "notify",
      target: "user"
    }
  ]
}
```

Workflows should eventually support:

- Manual execution
- Scheduled execution
- Event-triggered execution
- Conditional branches
- Tool calls
- Agent calls
- Human approval
- Notifications
- Memory updates

Example:

```text
Every morning
     ↓
Check competitor websites
     ↓
Local AI detects changes
     ↓
No meaningful change?
     └── Stop

Meaningful change?
     ↓
Research details
     ↓
Claude analyzes strategic significance
     ↓
Lead reviews
     ↓
Notify user
```

This prevents Claude from being called unnecessarily.

---

# 10. Plugins

Plugins should be treated as capability packages.

The planned addon uploader should evolve beyond simply injecting arbitrary JavaScript/CSS into the Regis DOM.

The goal is a controlled plugin system.

A plugin may provide:

- Tools
- Specialists
- Workflows
- Knowledge
- UI panels
- Commands
- Connectors
- Permissions

Example manifest:

```json
{
  "id": "shopify",
  "name": "Shopify",
  "version": "1.0.0",

  "type": "ai-capability",

  "description":
    "Allows AI teams to analyze Shopify stores.",

  "capabilities": [
    "orders.read",
    "products.read",
    "inventory.read",
    "analytics.read"
  ],

  "tools": [
    "get_orders",
    "get_products",
    "get_inventory"
  ],

  "workflows": [
    "daily-sales-report",
    "inventory-alert"
  ],

  "agents": [
    "ecommerce-analyst"
  ],

  "allowedTeams": [
    "marketing",
    "operations"
  ]
}
```

Plugins should be able to specialize a team without modifying Regis core code.

For example:

```text
Install Shopify plugin
        ↓
Operations Team gains:
        ↓
Shopify connector
E-commerce analyst
Inventory tools
Sales workflow
Revenue knowledge
```

The team itself remains the same organizational object.

---

# 11. Plugin Security

Do NOT make the plugin system equivalent to:

```js
eval(pluginCode)
```

or unrestricted JavaScript injection.

Plugins should have explicit capabilities and permissions.

Conceptually:

```text
Plugin
 ↓
Manifest
 ↓
Requested permissions
 ↓
User approval
 ↓
Registered capabilities
 ↓
Team access
```

Separate:

## UI plugins

Things such as:

- Panels
- Themes
- CSS
- UI enhancements

from:

## AI capability plugins

Things such as:

- Tools
- Agents
- Workflows
- Connectors
- Knowledge
- Memory

The existing browser extension system should remain separate from this architecture unless there is a strong reason to integrate them later.

---

# 12. Tool Architecture

Tools should have structured definitions.

Conceptually:

```js
{
  id: "get_orders",

  description:
    "Retrieve Shopify orders for a specified period.",

  inputSchema: {},

  permissions: [
    "shopify.orders.read"
  ],

  execute: async (input, context) => {
    // implementation
  }
}
```

The Lead should be able to determine:

```text
What needs to be done?
        ↓
What capability is required?
        ↓
Which tool provides it?
        ↓
Do we have permission?
        ↓
Execute
```

---

# 13. Permissions

Separate capabilities by risk.

At minimum:

```text
READ
DRAFT
WRITE
DESTRUCTIVE
```

Examples:

```text
Read email → READ
Draft email → DRAFT
Send email → WRITE
Delete email → DESTRUCTIVE
```

Teams should not automatically receive destructive permissions.

External writes should generally require user approval initially.

---

# 14. Existing Regis Compatibility

The new architecture must integrate with the existing Regis architecture instead of replacing working systems unnecessarily.

Important existing systems include:

- `lib/agents.js`
- `lib/ollama.js`
- `Guild`
- `systemFor`
- `Anthropic.sample`
- `regis-teams`
- `TM_KPI`
- `gdAsk`
- existing AI team UI
- existing local/Claude engine selection
- existing test infrastructure
- existing browser extension system

Preserve compatibility wherever practical.

Do not rewrite the entire application.

The current implementation is a large single-page/IIFE architecture, so avoid introducing global name collisions.

Use clear prefixes/modules consistent with existing Regis conventions.

---

# 15. Persistence

Do not assume SQLite is required immediately.

The current architecture uses localStorage for some team information.

The first implementation can continue using existing persistence mechanisms where practical.

However, structure the data layer so it can later move to a more robust database without redesigning the team architecture.

---

# 16. First Implementation Target

Do NOT attempt to build the entire vision in one pass.

Phase 1 should establish the foundation:

### Phase 1

Implement:

1. Persistent Team model
2. Persistent Lead model
3. Persistent Specialist model
4. Team → Lead → Specialist relationships
5. Team policy
6. Model router
7. Claude cost tracking
8. Claude call limits
9. Basic orchestration loop
10. Team memory abstraction
11. Workflow abstraction
12. Compatibility with existing team UI

Do NOT implement the complete plugin marketplace yet.

---

# 17. Phase 2

Implement:

1. Tool registry
2. Tool permissions
3. Workflow execution
4. Scheduled workflows
5. Human approval system
6. Better team dashboards
7. Team memory UI
8. Execution history
9. Cost dashboard

---

# 18. Phase 3

Implement:

1. Plugin manifest system
2. Plugin loader
3. Capability registry
4. Plugin permissions
5. Agent registration
6. Tool registration
7. Workflow registration
8. Team assignment
9. Plugin UI
10. Plugin enable/disable

---

# 19. Phase 4

Implement:

1. Advanced team builder
2. Team templates
3. Team cloning
4. Workflow editor
5. Agent editor
6. Memory management
7. Budget management
8. Advanced model routing
9. Autonomous scheduled operations
10. Cross-team collaboration

Cross-team collaboration should be explicit.

One team should not silently access another team's private memory or tools.

---

# 20. Example: Business Team

A future team might look like:

```text
Business Team
│
├── Lead
│
├── Market Research Specialist
├── Finance Specialist
├── Marketing Specialist
├── Operations Specialist
│
├── Web Research
├── Documents
├── Email
├── Calendar
│
├── Business Memory
│
├── Daily Research Workflow
├── Weekly Business Review
│
└── Policy
     ├── Local-first
     ├── Claude for complex reasoning
     ├── $5/day Claude budget
     └── Approval for external writes
```

The important point is that this is an actual software organization rather than four prompts.

---

# 21. Example: No-Code Team Specialization

A user should eventually be able to:

```text
Create Team
    ↓
"Marketing Team"
    ↓
Install Shopify Plugin
    ↓
Install Google Analytics Plugin
    ↓
Install Social Media Plugin
    ↓
Team automatically gains:
    ├── E-commerce Analyst
    ├── Sales tools
    ├── Analytics tools
    ├── Campaign workflows
    └── Relevant knowledge
```

The user should not need to edit JavaScript manually.

---

# 22. Design Principle

The long-term architecture should follow:

```text
Regis Core
     │
     ├── Teams
     │
     ├── Agents
     │
     ├── Tools
     │
     ├── Workflows
     │
     ├── Memory
     │
     ├── Policies
     │
     └── Plugin System
              │
              ├── Shopify
              ├── Google
              ├── Finance
              ├── Marketing
              ├── Research
              └── Future capabilities
```

The AI models sit underneath this architecture:

```text
                Regis
                  │
                Teams
                  │
              Orchestrator
             /            \
       Local AI           Claude
          │                  │
       simple             complex
       tasks               tasks
```

Claude should therefore be treated as an expensive reasoning resource, not as the foundation of the team architecture.

---

# 23. Success Criteria

The architecture is successful when the following statement becomes true:

> "I can create a Marketing Team, give it a mission, install capabilities, assign specialists, give it tools, create workflows, establish a budget, and let it perform useful work without every interaction being a chat with a different persona."

A second success criterion:

> "Regis can perform most routine work locally and only call Claude when the task genuinely benefits from stronger reasoning."

A third:

> "I can add a new capability through a plugin without rewriting Regis core."

A fourth:

> "The AI Lead behaves like an orchestrator rather than simply another chatbot persona."

---

# 24. Implementation Philosophy

Prioritize:

1. Reliability
2. Clear architecture
3. Low API cost
4. Security
5. Backward compatibility
6. Simple user experience
7. Extensibility
8. Performance

Do not sacrifice the responsiveness of the existing Regis application to make teams more autonomous.

Do not introduce unnecessary dependencies.

Do not rewrite working systems without a concrete reason.

When uncertain, preserve existing behavior and implement the smallest architectural layer that enables the next stage.