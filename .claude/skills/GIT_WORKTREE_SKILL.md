# Git Worktree Skill

> All ontology version control is managed via Git Worktrees using `pygit2`.
> Never shell out to the `git` command — always use `pygit2` in Python.
> Every Space has one bare repository. Every feature branch gets its own
> worktree directory on the server filesystem.

---

## Repository Setup

```python
import pygit2
import os
from pathlib import Path

BASE_PATH = Path(os.environ["GIT_REPOS_BASE_PATH"])  # e.g. /srv/eom-repos

def repo_path(space_id: str) -> Path:
    return BASE_PATH / f"space-{space_id}.git"

def worktree_path(space_id: str, branch_slug: str) -> Path:
    return BASE_PATH / "worktrees" / f"{space_id}-{branch_slug}"

def branch_slug(branch_name: str) -> str:
    """Convert branch name to filesystem-safe slug."""
    return branch_name.replace("/", "_").replace(" ", "_")[:50]
```

---

## Create Repository for a New Space

```python
async def create_space_repo(space_id: str, initial_manifest: dict) -> None:
    path = str(repo_path(space_id))
    import asyncio

    def _create():
        # 1. Create bare repository
        repo = pygit2.init_repository(path, bare=True)

        # 2. Create a temporary non-bare clone to commit initial files
        tmp_path = str(BASE_PATH / "tmp" / space_id)
        tmp_repo = pygit2.clone_repository(path, tmp_path)

        # 3. Write initial directory structure
        _write_initial_structure(tmp_path, space_id, initial_manifest)

        # 4. Stage all files
        tmp_repo.index.add_all()
        tmp_repo.index.write()

        # 5. Initial commit
        author = pygit2.Signature("EOM System", "eom@system")
        tree   = tmp_repo.index.write_tree()
        tmp_repo.create_commit(
            "refs/heads/main",
            author, author,
            "chore: initialise ontology space",
            tree, []
        )

        # 6. Push to bare repo and clean up tmp clone
        tmp_repo.remotes["origin"].push(["refs/heads/main:refs/heads/main"])
        import shutil; shutil.rmtree(tmp_path)

    await asyncio.to_thread(_create)


def _write_initial_structure(tmp_path: str, space_id: str, manifest: dict) -> None:
    import yaml, os
    dirs = [
        "shared-properties", "value-types", "interfaces",
        "object-types", "link-types", "packages", ".eom/opa-policies",
    ]
    for d in dirs:
        os.makedirs(os.path.join(tmp_path, d), exist_ok=True)

    # .eom/config.yaml
    config = {
        "space_id":       str(space_id),
        "name":           manifest["name"],
        "visibility":     manifest["visibility"],
        "owning_org_id":  manifest["owning_org_id"],
        "member_org_ids": manifest.get("member_org_ids", []),
        "tier":           manifest.get("tier", "DOMAIN"),
    }
    with open(os.path.join(tmp_path, ".eom/config.yaml"), "w") as f:
        yaml.dump(config, f)

    # VERSION
    with open(os.path.join(tmp_path, "VERSION"), "w") as f:
        f.write("0.1.0\n")

    # CHANGELOG.md
    with open(os.path.join(tmp_path, "CHANGELOG.md"), "w") as f:
        f.write("# Changelog\n\n## [0.1.0] — Initial\n- Space created\n")

    # package-lock.yaml
    with open(os.path.join(tmp_path, "package-lock.yaml"), "w") as f:
        yaml.dump({"packages": []}, f)

    # Copy default OPA policies from template
    import shutil
    template_dir = Path(__file__).parent.parent / "opa_policies_template"
    shutil.copytree(str(template_dir), os.path.join(tmp_path, ".eom/opa-policies"),
                    dirs_exist_ok=True)
```

---

## Create a Feature Branch and Worktree

```python
import pygit2, asyncio

async def create_branch(space_id: str, branch_name: str) -> str:
    """Returns the worktree filesystem path."""
    slug = branch_slug(branch_name)

    def _create():
        repo    = pygit2.Repository(str(repo_path(space_id)))
        main    = repo.branches["main"]
        wt_path = str(worktree_path(space_id, slug))

        # Create branch pointing at HEAD of main
        branch  = repo.branches.local.create(branch_name, main.peel(pygit2.Commit))

        # Add worktree (git worktree add equivalent)
        repo.add_worktree(wt_path, branch_name)

        return wt_path

    return await asyncio.to_thread(_create)
```

---

## Delete a Branch and Worktree

```python
import shutil

async def delete_branch(space_id: str, branch_name: str) -> None:
    slug = branch_slug(branch_name)

    def _delete():
        repo    = pygit2.Repository(str(repo_path(space_id)))
        wt_path = worktree_path(space_id, slug)

        # Prune worktree (equivalent to git worktree remove)
        for wt in repo.list_worktrees():
            if wt.name == branch_name or wt.path == str(wt_path):
                wt.prune(force=True)

        # Remove worktree directory
        if wt_path.exists():
            shutil.rmtree(str(wt_path))

        # Delete branch
        if branch_name in repo.branches.local:
            repo.branches.local[branch_name].delete()

    await asyncio.to_thread(_delete)
```

---

## Read Files from a Worktree

```python
import yaml
from pathlib import Path

def read_yaml(space_id: str, branch_name: str, relative_path: str) -> dict:
    """Read and parse a YAML file from a branch worktree."""
    slug    = branch_slug(branch_name)
    wt      = worktree_path(space_id, slug)
    full    = wt / relative_path
    if not full.exists():
        raise FileNotFoundError(f"{relative_path} not found in branch {branch_name}")
    with open(full) as f:
        return yaml.safe_load(f)

def write_yaml(space_id: str, branch_name: str, relative_path: str, data: dict) -> None:
    """Write a YAML file to a branch worktree."""
    slug    = branch_slug(branch_name)
    wt      = worktree_path(space_id, slug)
    full    = wt / relative_path
    full.parent.mkdir(parents=True, exist_ok=True)
    with open(full, "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=True)

def list_files(space_id: str, branch_name: str, subdir: str) -> list[str]:
    """List all YAML files in a worktree subdirectory."""
    slug    = branch_slug(branch_name)
    wt      = worktree_path(space_id, slug)
    target  = wt / subdir
    if not target.exists():
        return []
    return [str(p.relative_to(wt)) for p in target.rglob("*.yaml")]
```

---

## Commit Changes to a Branch

```python
async def commit_changes(
    space_id: str,
    branch_name: str,
    message: str,
    author_name: str,
    author_email: str,
) -> str:
    """Stage all changes in the worktree and create a commit. Returns commit SHA."""
    slug = branch_slug(branch_name)

    def _commit():
        wt_path = str(worktree_path(space_id, slug))
        repo    = pygit2.Repository(wt_path)

        repo.index.add_all()
        repo.index.write()
        tree = repo.index.write_tree()

        author    = pygit2.Signature(author_name, author_email)
        parent    = repo.head.target
        commit_id = repo.create_commit(
            repo.head.name,
            author, author,
            message,
            tree,
            [parent],
        )
        return str(commit_id)

    return await asyncio.to_thread(_commit)
```

---

## Semantic Diff Between Branches

```python
import json

async def compute_diff(space_id: str, base: str, head: str) -> dict:
    """
    Compute semantic diff between two branches.
    Returns structured diff (not raw text) for OPA and UI consumption.
    """
    base_slug = branch_slug(base)
    head_slug = branch_slug(head)

    def _diff():
        base_wt = worktree_path(space_id, base_slug) if base != "main" \
                  else repo_path(space_id)
        head_wt = worktree_path(space_id, head_slug)

        edits = []

        # Compare object types
        base_types = _load_all_object_types(str(base_wt), space_id, base)
        head_types = _load_all_object_types(str(head_wt), space_id, head)

        base_names = set(base_types.keys())
        head_names = set(head_types.keys())

        for name in head_names - base_names:
            edits.append({"operation": "ADD_OBJECT_TYPE", "api_name": name})

        for name in base_names - head_names:
            edits.append({"operation": "DELETE_OBJECT_TYPE", "api_name": name})

        for name in base_names & head_names:
            b, h = base_types[name], head_types[name]
            edits.extend(_diff_object_type(name, b, h))

        # Compare shared properties, link types, interfaces...
        edits.extend(_diff_shared_properties(base_wt, head_wt, space_id))
        edits.extend(_diff_link_types(base_wt, head_wt, space_id))
        edits.extend(_diff_interfaces(base_wt, head_wt, space_id))

        return {"space_id": str(space_id), "base": base, "head": head, "edits": edits}

    return await asyncio.to_thread(_diff)


def _diff_object_type(api_name: str, base: dict, head: dict) -> list[dict]:
    edits = []

    # Property-level diff
    base_props = {p["api_name"]: p for p in base.get("properties", [])}
    head_props = {p["api_name"]: p for p in head.get("properties", [])}

    for pname in set(head_props) - set(base_props):
        op = "ADD_REQUIRED_PROPERTY_TO_DRAFT" if head_props[pname].get("is_required") \
             else "ADD_OPTIONAL_PROPERTY"
        edits.append({"operation": op, "api_name": api_name, "property": pname})

    for pname in set(base_props) - set(head_props):
        edits.append({"operation": "DELETE_PROPERTY", "api_name": api_name, "property": pname})

    for pname in set(base_props) & set(head_props):
        b, h = base_props[pname], head_props[pname]
        if b["base_type"] != h["base_type"]:
            edits.append({"operation": "CHANGE_PROPERTY_BASE_TYPE",
                          "api_name": api_name, "property": pname,
                          "from": b["base_type"], "to": h["base_type"]})
        if not b.get("is_required") and h.get("is_required"):
            edits.append({"operation": "MAKE_PROPERTY_REQUIRED",
                          "api_name": api_name, "property": pname})
        if b.get("api_name") != h.get("api_name"):
            edits.append({"operation": "RENAME_PROPERTY",
                          "api_name": api_name,
                          "from": b["api_name"], "to": h["api_name"]})

    # Display name / description changes
    if base.get("description") != head.get("description"):
        edits.append({"operation": "UPDATE_DESCRIPTION", "api_name": api_name})

    return edits
```

---

## Rebase Branch onto Main

```python
async def rebase_onto_main(space_id: str, branch_name: str) -> dict:
    """
    Rebase a feature branch onto the latest main.
    Returns: {success: bool, conflicts: list[str], sha: str}
    """
    slug = branch_slug(branch_name)

    def _rebase():
        wt_path    = str(worktree_path(space_id, slug))
        repo       = pygit2.Repository(wt_path)
        main_repo  = pygit2.Repository(str(repo_path(space_id)))

        # Fetch latest main commit
        main_commit = main_repo.branches["main"].peel(pygit2.Commit)

        # Use pygit2 rebase
        rebase = repo.rebase(
            upstream=main_commit,
            branch=None,     # current branch
            onto=None,
        )

        conflicts = []
        while not rebase.finished:
            op = rebase.operation_current
            try:
                rebase.next()
            except pygit2.GitError as e:
                if "CONFLICT" in str(e):
                    conflict_files = [
                        p for p, (o, t, w) in repo.index.conflicts.items()
                    ]
                    conflicts.extend(conflict_files)
                    rebase.abort()
                    return {"success": False, "conflicts": conflict_files, "sha": None}

        new_sha = str(repo.head.target)
        return {"success": True, "conflicts": [], "sha": new_sha}

    return await asyncio.to_thread(_rebase)
```

---

## Get Commit Log for a Branch

```python
async def get_commit_log(space_id: str, branch_name: str, limit: int = 20) -> list[dict]:
    slug = branch_slug(branch_name)

    def _log():
        path = str(worktree_path(space_id, slug)) if branch_name != "main" \
               else str(repo_path(space_id))
        repo   = pygit2.Repository(path)
        head   = repo.head.peel(pygit2.Commit)

        commits = []
        for commit in repo.walk(head.id, pygit2.GIT_SORT_TOPOLOGICAL):
            commits.append({
                "sha":     str(commit.id),
                "message": commit.message.strip(),
                "author":  commit.author.name,
                "email":   commit.author.email,
                "time":    commit.commit_time,
            })
            if len(commits) >= limit:
                break
        return commits

    return await asyncio.to_thread(_log)
```

---

## Get Current VERSION from Worktree

```python
def get_version(space_id: str, branch_name: str = "main") -> str:
    if branch_name == "main":
        # Read from bare repo's HEAD
        def _read():
            repo  = pygit2.Repository(str(repo_path(space_id)))
            blob  = repo.revparse_single("HEAD:VERSION")
            return blob.data.decode().strip()
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            asyncio.to_thread(_read)
        )
    # Read from worktree
    wt = worktree_path(space_id, branch_slug(branch_name))
    version_file = wt / "VERSION"
    return version_file.read_text().strip()


def bump_version(space_id: str, change_class: str) -> str:
    """Bump the VERSION file in the main worktree after a merge."""
    current = get_version(space_id, "main")
    major, minor, patch = map(int, current.split("."))
    if change_class == "BREAKING":
        major += 1; minor = 0; patch = 0
    elif change_class == "NON_BREAKING":
        minor += 1; patch = 0
    else:  # ADDITIVE
        patch += 1
    new_version = f"{major}.{minor}.{patch}"
    # Write back to main (via a direct commit on the bare repo)
    # ... implementation uses pygit2 blob + tree + commit
    return new_version
```

---

## Pre-Commit Hook Script

This script is written to `.eom/hooks/pre-commit` in every worktree at creation:

```bash
#!/usr/bin/env bash
# EOM pre-commit hook — runs schema linter and OPA naming check

set -e

# Run EOM schema linter
eom lint --strict --quiet
if [ $? -ne 0 ]; then
  echo "❌ EOM schema lint failed. Fix errors before committing."
  exit 1
fi

# Run OPA naming check
CHANGED=$(git diff --cached --name-only --diff-filter=ACM | grep "\.yaml$" | head -20)
if [ -n "$CHANGED" ]; then
  eom check-naming --files "$CHANGED"
  if [ $? -ne 0 ]; then
    echo "❌ Naming convention violations found. Fix before committing."
    exit 1
  fi
fi

echo "✅ Pre-commit checks passed."
```

The Git Service installs this hook when creating a worktree:

```python
def install_hooks(worktree_path: str) -> None:
    import stat, os
    hooks_src = Path(__file__).parent.parent / "hooks" / "pre-commit"
    hooks_dst = Path(worktree_path) / ".git" / "hooks" / "pre-commit"
    hooks_dst.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy(str(hooks_src), str(hooks_dst))
    hooks_dst.chmod(hooks_dst.stat().st_mode | stat.S_IEXEC)
```
