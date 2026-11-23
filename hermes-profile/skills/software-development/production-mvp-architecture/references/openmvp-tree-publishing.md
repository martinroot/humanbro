# OpenMVP tree publishing

## Read/replace workflow

Use the direction-specific endpoint provided by the user or project owner:

- Read: `GET https://openmvp.online/tree/api_agent.php?id=<ID>`
- Full tree import: `POST https://openmvp.online/tree/api_agent.php`
- Single non-destructive task: `POST .../api_agent.php` with `action: "add_task"`

Before a full import, verify the returned ID and root title, then inspect current children and tasks. `action: "import"` replaces the entire subtree under that root; do not use it when existing material is nonempty unless replacement is explicit and the current tree has been captured for recovery.

## Payload shape

```json
{
  "id": 123,
  "action": "import",
  "direction": {
    "purpose": "One-sentence purpose and selected production boundary",
    "children": [
      {
        "title": "Module",
        "purpose": "What it owns and its current implementation state",
        "children": [{"title": "Submodule", "purpose": "Responsibility and blocker"}]
      }
    ],
    "tasks": [
      {"title": "P0 · Verifiable next step", "desc_md": "Acceptance criteria and dependencies", "priority": 5}
    ]
  }
}
```

Task priorities are integers 1–5. Keep nodes focused on modules and ownership; put work items in `tasks`, not as competing root architectures. Mark demo, legacy, offline, and target states explicitly. Omit secrets and customer data.

## Readback verification

After POST, GET the same ID again and verify:

1. `ok`, ID, and immutable root title match.
2. Root child count and total nested node count match the payload.
3. Submitted and returned node-title sets match; do not require the same list order because the API may reorder children.
4. Task-title sets, task count, and priorities match.

A successful POST response is not sufficient evidence; only a matching readback verifies the write.
