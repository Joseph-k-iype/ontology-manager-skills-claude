# EOM CLI Specification

> Complete implementation guide for the `eom` command-line tool.
> Built with Python Click. Installable as a PyPI package: `pip install eom-cli`.
> The CLI is the primary interface for schema-as-code workflows —
> branching, linting, diffing, PRs, rebase, and publish.

---

## Package Structure

```
packages/eom-cli/
├── pyproject.toml
├── eom_cli/
│   ├── __init__.py
│   ├── main.py                # Click group root
│   ├── config.py              # CLI config (API URL, auth token)
│   ├── client.py              # HTTP client wrapping EOM API
│   ├── commands/
│   │   ├── __init__.py
│   │   ├── space.py           # eom space create|list
│   │   ├── branch.py          # eom branch create|list|delete
│   │   ├── diff.py            # eom diff
│   │   ├── lint.py            # eom lint
│   │   ├── test_cmd.py        # eom test
│   │   ├── pr.py              # eom pr open|status|approve|merge
│   │   ├── rebase.py          # eom rebase
│   │   ├── compile.py         # eom compile
│   │   ├── export.py          # eom export
│   │   ├── measure.py         # eom measure (index size estimate)
│   │   ├── health.py          # eom health
│   │   ├── opa_cmd.py         # eom opa test
│   │   └── sdk.py             # eom sdk generate
│   ├── linter/
│   │   ├── __init__.py
│   │   ├── schema_linter.py   # YAML schema validation rules
│   │   ├── cypher_linter.py   # Compiled Cypher template checks
│   │   └── naming_linter.py   # Naming convention checks (calls OPA)
│   └── compiler/
│       ├── __init__.py        # Re-exports from SCHEMA_COMPILER_SKILL.md
│       ├── yaml_parser.py
│       ├── cypher_compiler.py
│       ├── es_mapper.py
│       └── meta_graph_compiler.py
└── tests/
    ├── test_lint.py
    ├── test_diff.py
    └── test_compile.py
```

---

## pyproject.toml

```toml
[build-system]
requires      = ["hatchling"]
build-backend = "hatchling.build"

[project]
name        = "eom-cli"
version     = "1.0.0"
description = "Enterprise Ontology Manager — Command Line Interface"
requires-python = ">=3.12"

dependencies = [
  "click>=8.1",
  "httpx>=0.27",
  "pyyaml>=6.0",
  "pydantic>=2.0",
  "pygit2>=1.15",
  "rich>=13.0",          # coloured terminal output
  "typer>=0.12",         # optional: wraps Click with type hints
  "jinja2>=3.1",         # Cypher template rendering
  "structlog>=24.0",
]

[project.scripts]
eom = "eom_cli.main:cli"

[tool.hatch.build.targets.wheel]
packages = ["eom_cli"]
```

---

## main.py — Click Root

```python
# eom_cli/main.py
import click
from rich.console import Console
from .commands import (
    space, branch, diff, lint, test_cmd, pr, rebase,
    compile_cmd, export, measure, health, opa_cmd, sdk,
)

console = Console()

@click.group()
@click.version_option(version="1.0.0", prog_name="eom")
@click.option("--api-url",    envvar="EOM_API_URL",    default="http://localhost:8000")
@click.option("--token",      envvar="EOM_API_TOKEN",   default=None)
@click.option("--space-id",   envvar="EOM_SPACE_ID",    default=None)
@click.option("--no-color",   is_flag=True, default=False)
@click.pass_context
def cli(ctx: click.Context, api_url: str, token: str, space_id: str, no_color: bool):
    """Enterprise Ontology Manager — schema-as-code CLI."""
    ctx.ensure_object(dict)
    ctx.obj["api_url"]  = api_url
    ctx.obj["token"]    = token
    ctx.obj["space_id"] = space_id
    ctx.obj["console"]  = Console(highlight=not no_color)

cli.add_command(space.space_group,    "space")
cli.add_command(branch.branch_group,  "branch")
cli.add_command(diff.diff_cmd,        "diff")
cli.add_command(lint.lint_cmd,        "lint")
cli.add_command(test_cmd.test_cmd,    "test")
cli.add_command(pr.pr_group,          "pr")
cli.add_command(rebase.rebase_cmd,    "rebase")
cli.add_command(compile_cmd.compile_cmd, "compile")
cli.add_command(export.export_cmd,    "export")
cli.add_command(measure.measure_cmd,  "measure")
cli.add_command(health.health_cmd,    "health")
cli.add_command(opa_cmd.opa_group,    "opa")
cli.add_command(sdk.sdk_group,        "sdk")

if __name__ == "__main__":
    cli()
```

---

## config.py

```python
# eom_cli/config.py
import os
from pathlib import Path
import yaml

CONFIG_PATH = Path.home() / ".eom" / "config.yaml"

def load_config() -> dict:
    """Load persisted config. CLI flags override, env vars override config file."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    return {}

def save_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f)

def get_space_id(ctx_space_id: str | None) -> str:
    """Resolve space_id: CLI flag → env var → .eom/config.yaml in cwd → error."""
    if ctx_space_id:
        return ctx_space_id
    env = os.environ.get("EOM_SPACE_ID")
    if env:
        return env
    # Look for .eom/config.yaml in current working directory
    local = Path.cwd() / ".eom" / "config.yaml"
    if local.exists():
        with open(local) as f:
            data = yaml.safe_load(f) or {}
        if data.get("space_id"):
            return data["space_id"]
    raise click.UsageError(
        "Space ID not found. Set --space-id, EOM_SPACE_ID, or run from a Space directory."
    )
```

---

## client.py

```python
# eom_cli/client.py
import httpx
from rich.console import Console

class EOMClient:
    def __init__(self, api_url: str, token: str | None, console: Console):
        self.base    = api_url.rstrip("/")
        self.token   = token
        self.console = console

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def get(self, path: str, **kwargs) -> dict:
        r = httpx.get(f"{self.base}{path}", headers=self._headers(), **kwargs)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, json: dict = None, **kwargs) -> dict:
        r = httpx.post(f"{self.base}{path}", json=json, headers=self._headers(), **kwargs)
        r.raise_for_status()
        return r.json()

    def delete(self, path: str, **kwargs) -> None:
        r = httpx.delete(f"{self.base}{path}", headers=self._headers(), **kwargs)
        r.raise_for_status()

    def from_ctx(ctx: dict) -> "EOMClient":
        return EOMClient(ctx["api_url"], ctx["token"], ctx["console"])
```

---

## commands/branch.py

```python
# eom_cli/commands/branch.py
import click
from rich.table import Table
from ..client   import EOMClient
from ..config   import get_space_id

@click.group("branch")
def branch_group():
    """Manage feature branches and worktrees."""

@branch_group.command("create")
@click.argument("branch_name")
@click.option("--description", "-d", default="")
@click.pass_context
def create_branch(ctx: click.Context, branch_name: str, description: str):
    """Create a feature branch and server-side worktree.

    \b
    Example:
        eom branch create feat/add-settlement-type
    """
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    with console.status(f"[bold blue]Creating branch [cyan]{branch_name}[/]..."):
        result = client.post(
            f"/api/v1/spaces/{space_id}/branches",
            json={"branch_name": branch_name, "description": description},
        )

    console.print(f"[green]✓[/] Branch [cyan]{branch_name}[/] created")
    console.print(f"  Worktree: [dim]{result.get('worktree_path', 'server-side')}[/]")
    console.print(f"  Sandbox graph: [dim]{result.get('sandbox_graph', '')}[/]")
    console.print(f"\n[dim]To switch to this branch: set EOM_BRANCH={branch_name}[/]")


@branch_group.command("list")
@click.pass_context
def list_branches(ctx: click.Context):
    """List all active branches for the current Space."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    branches = client.get(f"/api/v1/spaces/{space_id}/branches")

    table = Table(title=f"Branches — Space {space_id[:8]}…")
    table.add_column("Branch",     style="cyan")
    table.add_column("Status",     style="bold")
    table.add_column("Creator",    style="dim")
    table.add_column("Created",    style="dim")
    table.add_column("Last Commit",style="dim")

    STATUS_STYLE = {
        "ACTIVE":    "[green]● ACTIVE[/]",
        "IN_REVIEW": "[yellow]◐ IN_REVIEW[/]",
        "APPROVED":  "[blue]✓ APPROVED[/]",
        "MERGED":    "[dim]⌀ MERGED[/]",
        "REJECTED":  "[red]✗ REJECTED[/]",
    }

    for b in branches:
        table.add_row(
            b["branch_name"],
            STATUS_STYLE.get(b["status"], b["status"]),
            b.get("creator_id", "")[:8],
            b.get("created_at", "")[:10],
            (b.get("last_commit_sha") or "")[:8],
        )

    console.print(table)


@branch_group.command("delete")
@click.argument("branch_name")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation prompt")
@click.pass_context
def delete_branch(ctx: click.Context, branch_name: str, force: bool):
    """Delete a branch and clean up its worktree and sandbox graphs."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    if not force:
        click.confirm(
            f"Delete branch '{branch_name}' and its sandbox resources?",
            abort=True
        )

    client.delete(f"/api/v1/spaces/{space_id}/branches/{branch_name}")
    console.print(f"[green]✓[/] Branch [cyan]{branch_name}[/] deleted")
```

---

## commands/diff.py

```python
# eom_cli/commands/diff.py
import click, json
from rich.table  import Table
from rich.panel  import Panel
from rich        import box
from ..client    import EOMClient
from ..config    import get_space_id

CHANGE_STYLE = {
    "ADDITIVE":     ("[green]+[/]",  "green"),
    "NON_BREAKING": ("[yellow]~[/]", "yellow"),
    "BREAKING":     ("[red]![/]",    "red"),
}

@click.command("diff")
@click.argument("head",  default=None, required=False)
@click.option("--base",  default="main",  show_default=True)
@click.option("--json",  "as_json", is_flag=True, help="Output raw JSON (for piping to OPA)")
@click.pass_context
def diff_cmd(ctx: click.Context, head: str | None, base: str, as_json: bool):
    """Show semantic diff between two branches.

    \b
    Examples:
        eom diff                           # diff current branch vs main
        eom diff feat/add-trade-type       # diff named branch vs main
        eom diff feat/x --base feat/y      # diff two branches
        eom diff --json > diff.json        # pipe to OPA
    """
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    branch   = head or _current_branch()
    result   = client.get(
        f"/api/v1/spaces/{space_id}/branches/{branch}/diff",
        params={"base": base}
    )

    if as_json:
        click.echo(json.dumps(result, indent=2))
        return

    edits        = result.get("edits", [])
    change_class = result.get("change_class", "ADDITIVE")

    if not edits:
        console.print("[green]✓ No schema changes detected.[/]")
        return

    # Group edits by change class
    groups: dict[str, list] = {"ADDITIVE": [], "NON_BREAKING": [], "BREAKING": []}
    for edit in edits:
        cls = _classify(edit["operation"])
        groups[cls].append(edit)

    console.print(Panel(
        f"[bold]Diff:[/] [cyan]{base}[/] → [cyan]{branch}[/]\n"
        f"Overall: [bold]{_style_class(change_class)}[/]",
        box=box.ROUNDED,
    ))

    for cls, cls_edits in groups.items():
        if not cls_edits:
            continue
        icon, colour = CHANGE_STYLE[cls]
        console.print(f"\n[{colour}]{cls}[/] ({len(cls_edits)} change{'s' if len(cls_edits)!=1 else ''})")
        for edit in cls_edits:
            op  = edit["operation"]
            obj = edit.get("api_name", "")
            prop = edit.get("property", "")
            detail = f"[dim].{prop}[/]" if prop else ""
            console.print(f"  {icon} {obj}{detail}  [dim]{op}[/]")

    # Impact summary
    if result.get("impact_score") is not None:
        score = result["impact_score"]
        colour = "green" if score < 20 else "yellow" if score < 60 else "red"
        console.print(f"\n[bold]Impact score:[/] [{colour}]{score:.0f}[/] / 100")


def _classify(operation: str) -> str:
    additive    = {"ADD_OBJECT_TYPE","ADD_LINK_TYPE","ADD_ACTION_TYPE","ADD_INTERFACE",
                   "ADD_OPTIONAL_PROPERTY","ADD_TAG","ADD_SEMANTIC_ANNOTATION",
                   "ADD_INTERFACE_IMPLEMENTATION","ASSIGN_STEWARD","ADD_TYPE_REFERENCE"}
    non_breaking= {"UPDATE_DESCRIPTION","UPDATE_DISPLAY_NAME","UPDATE_SENSITIVITY_LABEL",
                   "ADD_REQUIRED_PROPERTY_TO_DRAFT","ADD_DERIVED_PROPERTY"}
    if operation in additive:      return "ADDITIVE"
    if operation in non_breaking:  return "NON_BREAKING"
    return "BREAKING"

def _style_class(cls: str) -> str:
    return {"ADDITIVE":"[green]ADDITIVE[/]",
            "NON_BREAKING":"[yellow]NON_BREAKING[/]",
            "BREAKING":"[bold red]BREAKING[/]"}.get(cls, cls)

def _current_branch() -> str:
    """Detect current branch from local .eom/branch file or env var."""
    import os
    env = os.environ.get("EOM_BRANCH")
    if env:
        return env
    branch_file = Path(".eom") / "branch"
    if branch_file.exists():
        return branch_file.read_text().strip()
    raise click.UsageError(
        "Cannot determine current branch. "
        "Pass branch name as argument or set EOM_BRANCH."
    )
```

---

## commands/lint.py

```python
# eom_cli/commands/lint.py
import click, sys
from pathlib    import Path
from rich.table import Table
from rich       import box
from ..linter   import run_all_linters
from ..config   import get_space_id

@click.command("lint")
@click.option("--strict",     is_flag=True, help="Fail on warnings as well as errors")
@click.option("--quiet",      is_flag=True, help="Only print summary, not individual violations")
@click.option("--branch",     default=None, help="Branch to lint (defaults to current)")
@click.option("--worktree",   default=None, help="Path to worktree (if running locally)")
@click.pass_context
def lint_cmd(ctx: click.Context, strict: bool, quiet: bool, branch: str, worktree: str):
    """Run the EOM schema linter on the current or specified branch.

    \b
    Checks:
      • YAML schema validity (Pydantic model validation)
      • Required metadata fields (description, steward, domain on PUBLISHED types)
      • Naming conventions (api_name patterns, no reserved DB prefixes)
      • Circular interface inheritance
      • Orphan link types (source or target type does not exist)
      • DRY violations (local property duplicates a shared property)
      • Action Type compiled Cypher template presence and basic validity
      • Submission criteria reference valid properties
    """
    space_id  = get_space_id(ctx.obj.get("space_id"))
    console   = ctx.obj["console"]

    if worktree:
        wt_path = Path(worktree)
    else:
        wt_path = Path.cwd()  # assume CLI runs from within the worktree

    with console.status("[bold blue]Running schema linter…"):
        results = run_all_linters(wt_path, strict=strict)

    errors   = [r for r in results if r["level"] == "ERROR"]
    warnings = [r for r in results if r["level"] == "WARNING"]
    infos    = [r for r in results if r["level"] == "INFO"]

    if not quiet:
        table = Table(box=box.SIMPLE, show_header=True)
        table.add_column("Level",   style="bold", width=9)
        table.add_column("File",    style="dim",  width=40)
        table.add_column("Rule",    width=30)
        table.add_column("Message")

        LEVEL_STYLE = {"ERROR":"[red]ERROR[/]","WARNING":"[yellow]WARN[/]","INFO":"[dim]INFO[/]"}

        for r in results:
            table.add_row(
                LEVEL_STYLE[r["level"]],
                r.get("file", ""),
                r.get("rule", ""),
                r["message"],
            )
        if results:
            console.print(table)

    # Summary
    if errors:
        console.print(f"\n[red]✗ Lint failed:[/] {len(errors)} error(s), {len(warnings)} warning(s)")
        sys.exit(1)
    elif warnings and strict:
        console.print(f"\n[yellow]✗ Lint failed (--strict):[/] {len(warnings)} warning(s)")
        sys.exit(1)
    else:
        console.print(f"\n[green]✓ Lint passed[/]  {len(warnings)} warning(s), {len(infos)} info(s)")
```

---

## linter/__init__.py — All lint rules

```python
# eom_cli/linter/__init__.py
from pathlib import Path
import yaml, re
from typing  import Any

def run_all_linters(worktree: Path, strict: bool = False) -> list[dict]:
    """Run all lint rules and return a flat list of findings."""
    findings = []
    findings.extend(_lint_object_types(worktree))
    findings.extend(_lint_link_types(worktree))
    findings.extend(_lint_shared_properties(worktree))
    findings.extend(_lint_interfaces(worktree))
    findings.extend(_lint_action_types(worktree))
    findings.extend(_lint_cross_references(worktree))
    return findings


def _lint_object_types(worktree: Path) -> list[dict]:
    findings = []
    for yaml_file in (worktree / "object-types").rglob("schema.yaml"):
        try:
            data = yaml.safe_load(yaml_file.read_text())
        except yaml.YAMLError as e:
            findings.append(_err(str(yaml_file), "YAML_PARSE", str(e)))
            continue

        api_name = data.get("api_name", "")
        rel_path = str(yaml_file.relative_to(worktree))

        # Required fields
        if not data.get("description"):
            if data.get("status") == "PUBLISHED":
                findings.append(_err(rel_path, "MISSING_DESCRIPTION",
                    f"{api_name}: PUBLISHED type must have a description"))
            else:
                findings.append(_warn(rel_path, "MISSING_DESCRIPTION",
                    f"{api_name}: description is strongly recommended"))

        if not data.get("domain"):
            findings.append(_warn(rel_path, "MISSING_DOMAIN",
                f"{api_name}: domain is not set"))

        if not data.get("steward_id") and data.get("status") == "PUBLISHED":
            findings.append(_err(rel_path, "MISSING_STEWARD",
                f"{api_name}: PUBLISHED type must have a steward_id"))

        # api_name validation
        if not re.match(r'^[a-z][a-z0-9_]{1,79}$', api_name):
            findings.append(_err(rel_path, "INVALID_API_NAME",
                f"api_name '{api_name}' must be lowercase snake_case, 2-80 chars"))

        # Reserved prefix check
        reserved = ["tbl_","t_","fact_","dim_","vw_","tmp_","stg_","raw_","ext_"]
        for prefix in reserved:
            if api_name.startswith(prefix):
                findings.append(_err(rel_path, "RESERVED_PREFIX",
                    f"api_name '{api_name}' starts with reserved prefix '{prefix}'"))

        # Properties
        seen_props = set()
        for prop in data.get("properties", []):
            pname = prop.get("api_name", "")
            if pname in seen_props:
                findings.append(_err(rel_path, "DUPLICATE_PROPERTY",
                    f"{api_name}.{pname}: property api_name is duplicated"))
            seen_props.add(pname)

            if not re.match(r'^[a-z][a-zA-Z0-9]{0,79}$', pname):
                findings.append(_err(rel_path, "INVALID_PROPERTY_NAME",
                    f"{api_name}.{pname}: property api_name must be camelCase"))

            if prop.get("is_required") and prop.get("derived_expression"):
                findings.append(_err(rel_path, "REQUIRED_DERIVED_PROPERTY",
                    f"{api_name}.{pname}: derived properties cannot be required"))

        # Action Types
        for at in data.get("action_types", []):
            at_name  = at.get("api_name", "")
            compiled = worktree / "object-types" / api_name / "action-types" / f"{at_name}.cypher"
            if not compiled.exists():
                findings.append(_err(rel_path, "MISSING_COMPILED_CYPHER",
                    f"{api_name}/{at_name}: compiled Cypher template not found at "
                    f"object-types/{api_name}/action-types/{at_name}.cypher"))

    return findings


def _lint_link_types(worktree: Path) -> list[dict]:
    findings   = []
    object_type_names = _all_object_type_names(worktree)

    for yaml_file in (worktree / "link-types").rglob("*.yaml"):
        data     = yaml.safe_load(yaml_file.read_text()) or {}
        rel_path = str(yaml_file.relative_to(worktree))
        api_name = data.get("api_name", "")

        src = data.get("source_object_type", "")
        tgt = data.get("target_object_type", "")

        if src and src not in object_type_names:
            findings.append(_err(rel_path, "ORPHAN_LINK_SOURCE",
                f"{api_name}: source_object_type '{src}' does not exist"))
        if tgt and tgt not in object_type_names:
            findings.append(_err(rel_path, "ORPHAN_LINK_TARGET",
                f"{api_name}: target_object_type '{tgt}' does not exist"))

        if not re.match(r'^[a-z][a-z0-9_]{1,79}$', api_name):
            findings.append(_err(rel_path, "INVALID_LINK_API_NAME",
                f"Link type api_name '{api_name}' must be lowercase snake_case"))

    return findings


def _lint_interfaces(worktree: Path) -> list[dict]:
    findings = []
    ifaces   = {}

    for yaml_file in (worktree / "interfaces").rglob("*.yaml"):
        data = yaml.safe_load(yaml_file.read_text()) or {}
        ifaces[data.get("api_name", "")] = data

    # Circular inheritance check
    for iname, iface in ifaces.items():
        chain = set()
        current = iname
        while current:
            if current in chain:
                findings.append(_err(
                    f"interfaces/{iname}.yaml", "CIRCULAR_INHERITANCE",
                    f"Interface '{iname}' has circular inheritance through '{current}'"
                ))
                break
            chain.add(current)
            parents = ifaces.get(current, {}).get("extends_interfaces", [])
            current = parents[0] if parents else None

    return findings


def _lint_action_types(worktree: Path) -> list[dict]:
    findings = []
    for cypher_file in worktree.rglob("action-types/*.cypher"):
        content  = cypher_file.read_text()
        rel_path = str(cypher_file.relative_to(worktree))

        if "RETURN" not in content:
            findings.append(_err(rel_path, "CYPHER_MISSING_RETURN",
                "Compiled Cypher template must have a RETURN clause"))

        if "object_id" not in content:
            findings.append(_err(rel_path, "CYPHER_MISSING_OBJECT_ID",
                "Compiled Cypher template must return object_id"))

        for ddl in ["CREATE INDEX", "CREATE CONSTRAINT", "CREATE DATABASE"]:
            if ddl in content.upper():
                findings.append(_err(rel_path, "CYPHER_DDL_IN_TEMPLATE",
                    f"DDL statement '{ddl}' is not allowed in action templates"))

        # Check parameterisation — no hardcoded UUIDs
        uuid_re = r"_eom_id\s*=\s*'[a-f0-9]{8}-"
        if re.search(uuid_re, content):
            findings.append(_err(rel_path, "CYPHER_HARDCODED_ID",
                "Hardcoded UUID found — use $object_id parameter instead"))

    return findings


def _lint_shared_properties(worktree: Path) -> list[dict]:
    findings = []
    shared   = _all_shared_property_names(worktree)

    for yaml_file in (worktree / "object-types").rglob("schema.yaml"):
        data = yaml.safe_load(yaml_file.read_text()) or {}
        for prop in data.get("properties", []):
            pname = prop.get("api_name", "")
            if pname in shared and not prop.get("is_shared"):
                findings.append(_warn(
                    str(yaml_file.relative_to(worktree)),
                    "DRY_VIOLATION",
                    f"Property '{pname}' duplicates shared property — "
                    f"use shared_property_refs instead of defining locally"
                ))
    return findings


def _lint_cross_references(worktree: Path) -> list[dict]:
    """Validate that all referenced interfaces and value types exist."""
    findings      = []
    iface_names   = _all_interface_names(worktree)
    value_types   = _all_value_type_names(worktree)

    for yaml_file in (worktree / "object-types").rglob("schema.yaml"):
        data     = yaml.safe_load(yaml_file.read_text()) or {}
        rel_path = str(yaml_file.relative_to(worktree))
        api_name = data.get("api_name", "")

        for iface in data.get("interfaces", []):
            if iface not in iface_names:
                findings.append(_err(rel_path, "UNKNOWN_INTERFACE",
                    f"{api_name}: interface '{iface}' not found"))

        for prop in data.get("properties", []):
            vt = prop.get("value_type_ref")
            if vt and vt not in value_types:
                findings.append(_warn(rel_path, "UNKNOWN_VALUE_TYPE",
                    f"{api_name}.{prop['api_name']}: value_type_ref '{vt}' not found"))
    return findings


# ── Helpers ──────────────────────────────────────────────────────────────────

def _err(file: str, rule: str, msg: str) -> dict:
    return {"level": "ERROR", "file": file, "rule": rule, "message": msg}

def _warn(file: str, rule: str, msg: str) -> dict:
    return {"level": "WARNING", "file": file, "rule": rule, "message": msg}

def _all_object_type_names(worktree: Path) -> set[str]:
    names = set()
    for f in (worktree / "object-types").rglob("schema.yaml"):
        try:
            data = yaml.safe_load(f.read_text()) or {}
            if data.get("api_name"):
                names.add(data["api_name"])
        except Exception:
            pass
    return names

def _all_shared_property_names(worktree: Path) -> set[str]:
    names = set()
    for f in (worktree / "shared-properties").rglob("*.yaml"):
        try:
            data = yaml.safe_load(f.read_text()) or {}
            if data.get("api_name"):
                names.add(data["api_name"])
        except Exception:
            pass
    return names

def _all_interface_names(worktree: Path) -> set[str]:
    return {
        yaml.safe_load(f.read_text()).get("api_name", "")
        for f in (worktree / "interfaces").rglob("*.yaml")
    }

def _all_value_type_names(worktree: Path) -> set[str]:
    return {
        yaml.safe_load(f.read_text()).get("api_name", "")
        for f in (worktree / "value-types").rglob("*.yaml")
    }
```

---

## commands/pr.py

```python
# eom_cli/commands/pr.py
import click
from rich.panel  import Panel
from rich.table  import Table
from rich        import box
from ..client    import EOMClient
from ..config    import get_space_id

@click.group("pr")
def pr_group():
    """Manage Pull Requests (Proposals)."""

@pr_group.command("open")
@click.argument("branch_name")
@click.option("--title",       "-t", required=True, prompt=True)
@click.option("--description", "-d", default="")
@click.pass_context
def open_pr(ctx: click.Context, branch_name: str, title: str, description: str):
    """Open a Pull Request for a branch. Triggers the CI validation pipeline.

    \b
    Example:
        eom pr open feat/add-settlement-type --title "Add settlement type to trade confirmation"
    """
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    with console.status("[bold blue]Opening PR and triggering CI…"):
        result = client.post(
            f"/api/v1/spaces/{space_id}/proposals",
            json={"branch_name": branch_name, "title": title, "description": description},
        )

    pr_id        = result["id"]
    change_class = result.get("change_class", "PENDING")

    console.print(Panel(
        f"[bold green]✓ PR #{pr_id[:8]} opened[/]\n\n"
        f"Branch:       [cyan]{branch_name}[/]\n"
        f"Title:        {title}\n"
        f"Change class: [bold]{change_class}[/]\n"
        f"CI status:    [dim]{result.get('ci_status', 'running…')}[/]",
        title="Proposal Created",
        box=box.ROUNDED,
    ))


@pr_group.command("status")
@click.argument("pr_id")
@click.pass_context
def pr_status(ctx: click.Context, pr_id: str):
    """Check PR status, CI results, and approval progress."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    pr       = client.get(f"/api/v1/spaces/{space_id}/proposals/{pr_id}")
    approvals= pr.get("approvals", [])

    CI_STYLE = {"passed":"[green]✓ passed[/]","failed":"[red]✗ failed[/]","running":"[yellow]⟳ running[/]"}
    STATUS_STYLE = {"IN_REVIEW":"[yellow]IN_REVIEW[/]","APPROVED":"[green]APPROVED[/]","MERGED":"[dim]MERGED[/]"}

    console.print(Panel(
        f"[bold]PR {pr_id[:8]}[/] — {pr['title']}\n\n"
        f"Branch:       [cyan]{pr['branch_name']}[/]\n"
        f"Status:       {STATUS_STYLE.get(pr['status'], pr['status'])}\n"
        f"Change class: [bold]{pr.get('change_class','—')}[/]\n"
        f"CI:           {CI_STYLE.get(pr.get('ci_status',''), pr.get('ci_status','—'))}\n"
        f"Impact score: {pr.get('impact_score','—')}\n"
        f"Approvals:    {len(approvals)}",
        box=box.ROUNDED,
    ))

    if approvals:
        tbl = Table(box=box.SIMPLE)
        tbl.add_column("Approver")
        tbl.add_column("Role")
        tbl.add_column("Date")
        for a in approvals:
            tbl.add_row(a["approver_id"][:8], a["role"], a.get("approved_at","")[:10])
        console.print(tbl)


@pr_group.command("approve")
@click.argument("pr_id")
@click.option("--comment", "-c", default="")
@click.pass_context
def approve_pr(ctx: click.Context, pr_id: str, comment: str):
    """Submit your approval for a PR."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    client.post(f"/api/v1/spaces/{space_id}/proposals/{pr_id}/approve",
                json={"comment": comment})
    console.print(f"[green]✓[/] Approval submitted for PR [cyan]{pr_id[:8]}[/]")


@pr_group.command("merge")
@click.argument("pr_id")
@click.option("--force", is_flag=True, help="Bypass final approval check (admin only)")
@click.pass_context
def merge_pr(ctx: click.Context, pr_id: str, force: bool):
    """Merge an approved PR and publish ontology changes to production."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    with console.status("[bold blue]Merging PR and publishing to production…"):
        result = client.post(
            f"/api/v1/spaces/{space_id}/proposals/{pr_id}/merge",
            json={"force": force},
        )

    new_version = result.get("new_version", "—")
    console.print(f"[green]✓[/] PR merged — ontology published at [bold]v{new_version}[/]")
    console.print(f"[dim]SDK regeneration queued. SDKs will be available in ~30s.[/]")
```

---

## commands/rebase.py

```python
# eom_cli/commands/rebase.py
import click
from ..client import EOMClient
from ..config import get_space_id

@click.command("rebase")
@click.argument("branch_name", required=False)
@click.option("--onto", default="main", show_default=True)
@click.pass_context
def rebase_cmd(ctx: click.Context, branch_name: str | None, onto: str):
    """Rebase a branch onto another (default: main).

    Uses the semantic merge tool — YAML conflicts are resolved ontology-aware,
    not as raw text. Raw diff3 markers are never shown.

    \b
    Examples:
        eom rebase feat/add-settlement-type
        eom rebase feat/x --onto feat/y
    """
    from .diff  import _current_branch
    space_id  = get_space_id(ctx.obj.get("space_id"))
    client    = EOMClient.from_ctx(ctx.obj)
    console   = ctx.obj["console"]
    branch    = branch_name or _current_branch()

    with console.status(f"[bold blue]Rebasing [cyan]{branch}[/] onto [cyan]{onto}[/]…"):
        result = client.post(
            f"/api/v1/spaces/{space_id}/branches/{branch}/rebase",
            json={"onto": onto},
        )

    if result.get("success"):
        sha = result.get("sha", "")[:8]
        console.print(f"[green]✓[/] Rebase complete  [{sha}]")
    else:
        conflicts = result.get("conflicts", [])
        console.print(f"[red]✗ Rebase conflict in {len(conflicts)} file(s):[/]")
        for c in conflicts:
            console.print(f"  [red]•[/] {c}")
        console.print(
            "\n[dim]Open EOM Studio → Explore → Branch panel → Semantic Merge Tool to resolve.[/]"
        )
        raise SystemExit(1)
```

---

## commands/measure.py

```python
# eom_cli/commands/measure.py
import click
from rich.table import Table
from rich       import box
from ..client   import EOMClient
from ..config   import get_space_id

@click.command("measure")
@click.option("--branch", default=None, help="Branch to measure (defaults to current)")
@click.option("--output", type=click.Path(), default=None, help="Write JSON to file")
@click.pass_context
def measure_cmd(ctx: click.Context, branch: str | None, output: str | None):
    """Estimate FalkorDB and Elasticsearch storage impact for a branch.

    Posts the estimate as a PR comment when run in CI.

    \b
    Example:
        eom measure --branch feat/add-settlement-type
    """
    from .diff  import _current_branch
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]
    branch   = branch or _current_branch()

    with console.status("[bold blue]Computing index size estimates…"):
        result = client.get(
            f"/api/v1/spaces/{space_id}/branches/{branch}/measure"
        )

    if output:
        import json
        with open(output, "w") as f:
            json.dump(result, f, indent=2)
        console.print(f"[green]✓[/] Estimates written to {output}")
        return

    tbl = Table(title="Storage Estimate — Branch vs Main", box=box.ROUNDED)
    tbl.add_column("Object Type",   style="cyan")
    tbl.add_column("FalkorDB Δ",    justify="right")
    tbl.add_column("ES Index Δ",    justify="right")
    tbl.add_column("Doc Count Δ",   justify="right")

    for row in result.get("estimates", []):
        tbl.add_row(
            row["object_type"],
            _fmt_bytes(row.get("falkordb_delta_bytes", 0)),
            _fmt_bytes(row.get("es_delta_bytes", 0)),
            f"{row.get('doc_delta', 0):+,}",
        )

    console.print(tbl)
    total_falkor = sum(r.get("falkordb_delta_bytes", 0) for r in result.get("estimates", []))
    total_es     = sum(r.get("es_delta_bytes", 0) for r in result.get("estimates", []))
    console.print(f"\n[bold]Total delta:[/] FalkorDB {_fmt_bytes(total_falkor)} · ES {_fmt_bytes(total_es)}")


def _fmt_bytes(b: int) -> str:
    if abs(b) < 1024:         return f"{b:+} B"
    if abs(b) < 1024**2:      return f"{b/1024:+.1f} KB"
    if abs(b) < 1024**3:      return f"{b/1024**2:+.1f} MB"
    return f"{b/1024**3:+.2f} GB"
```

---

## commands/health.py

```python
# eom_cli/commands/health.py
import click
from rich.panel  import Panel
from rich.table  import Table
from rich        import box
from ..client    import EOMClient
from ..config    import get_space_id

@click.command("health")
@click.option("--recompute", is_flag=True, help="Trigger an immediate OHS recomputation")
@click.pass_context
def health_cmd(ctx: click.Context, recompute: bool):
    """Show the Ontology Health Score for the current Space."""
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    if recompute:
        with console.status("[bold blue]Recomputing OHS…"):
            client.post(f"/api/v1/spaces/{space_id}/health/recompute")

    ohs = client.get(f"/api/v1/spaces/{space_id}/health")

    score  = ohs["overall_score"]
    colour = "green" if score >= 80 else "yellow" if score >= 60 else "red"

    console.print(Panel(
        f"[bold {colour}]{score:.0f}/100[/bold {colour}]  Ontology Health Score",
        title=f"Space {space_id[:8]}…",
        box=box.ROUNDED,
    ))

    tbl = Table(box=box.SIMPLE, show_header=True)
    tbl.add_column("Dimension",       width=22)
    tbl.add_column("Score",           justify="right", width=8)
    tbl.add_column("Weight",          justify="right", width=8)
    tbl.add_column("Top Violation")

    DIMS = [
        ("completeness",     ohs["completeness"]),
        ("dry_conformance",  ohs["dry_conformance"]),
        ("change_governance",ohs["change_governance"]),
        ("freshness",        ohs["freshness"]),
        ("utilisation",      ohs["utilisation"]),
    ]

    for key, dim in DIMS:
        s     = dim["score"]
        sc    = "green" if s >= 80 else "yellow" if s >= 60 else "red"
        viol  = dim["violations"][0] if dim["violations"] else "[dim]None[/]"
        tbl.add_row(
            dim["name"],
            f"[{sc}]{s:.0f}[/]",
            f"{dim['weight']*100:.0f}%",
            viol[:60],
        )

    console.print(tbl)

    if ohs.get("alerts"):
        console.print(f"\n[yellow]⚠ {len(ohs['alerts'])} active alert(s)[/]")
        for alert in ohs["alerts"][:3]:
            console.print(f"  • {alert.get('message','')}")
```

---

## commands/export.py

```python
# eom_cli/commands/export.py
import click, sys
from ..client import EOMClient
from ..config import get_space_id

@click.command("export")
@click.option("--format", "-f", "fmt",
              type=click.Choice(["yaml","jsonld","turtle","avro","graphql"]),
              default="yaml", show_default=True)
@click.option("--output", "-o", type=click.Path(), default=None,
              help="Write to file (default: stdout)")
@click.option("--branch", default=None)
@click.pass_context
def export_cmd(ctx: click.Context, fmt: str, output: str | None, branch: str | None):
    """Export the ontology in a standard format.

    \b
    Formats:
        yaml     — EOM native YAML (default)
        jsonld   — JSON-LD (compatible with semantic web tooling)
        turtle   — Turtle/TTL (RDF serialisation)
        avro     — Apache Avro schema (for Kafka / data pipelines)
        graphql  — GraphQL SDL (auto-generated from published ontology)

    \b
    Example:
        eom export --format jsonld --output ontology.jsonld
    """
    space_id = get_space_id(ctx.obj.get("space_id"))
    client   = EOMClient.from_ctx(ctx.obj)
    console  = ctx.obj["console"]

    with console.status(f"[bold blue]Exporting as {fmt.upper()}…"):
        payload  = {"format": fmt}
        if branch:
            payload["branch"] = branch
        result   = client.post(f"/api/v1/spaces/{space_id}/export", json=payload)

    content = result.get("content", "")

    if output:
        with open(output, "w") as f:
            f.write(content)
        console.print(f"[green]✓[/] Exported to {output}")
    else:
        click.echo(content)
```

---

## Full CLI Reference (eom --help output)

```
Usage: eom [OPTIONS] COMMAND [ARGS]...

  Enterprise Ontology Manager — schema-as-code CLI.

Options:
  --api-url TEXT    EOM API base URL  [env var: EOM_API_URL]
  --token TEXT      Bearer token      [env var: EOM_API_TOKEN]
  --space-id TEXT   Space ID          [env var: EOM_SPACE_ID]
  --no-color        Disable colour output
  --version         Show version
  --help            Show this message and exit.

Commands:
  branch   Manage feature branches and worktrees.
    create   Create a feature branch and server-side worktree.
    list     List all active branches for the current Space.
    delete   Delete a branch and clean up its sandbox resources.

  compile  Compile YAML manifests → FalkorDB DDL + ES mappings + Cypher templates.

  diff     Show semantic diff between two branches.

  export   Export the ontology in a standard format (yaml|jsonld|turtle|avro|graphql).

  health   Show the Ontology Health Score for the current Space.

  lint     Run the EOM schema linter on the current or specified branch.

  measure  Estimate FalkorDB and Elasticsearch storage impact for a branch.

  opa      OPA policy management.
    test     Run OPA unit tests for the current Space's policy bundle.
    push     Push current policy bundle to the OPA sidecar.

  pr       Manage Pull Requests (Proposals).
    open     Open a Pull Request for a branch.
    status   Check PR status, CI results, and approval progress.
    approve  Submit your approval for a PR.
    merge    Merge an approved PR and publish to production.

  rebase   Rebase a branch onto another (default: main).

  sdk      Auto-generated SDK management.
    generate  Manually trigger SDK regeneration for the current Space.
    publish   Publish generated SDK to package registries.

  space    Space management.
    create   Create a new Space (auto-creates Git repo and FalkorDB graphs).
    list     List all accessible Spaces.

  test     Run schema tests and Action Type integration tests on sandbox.
```
