# benchmarks/eval_benchmarks/mssbench/mssbench.py
"""
MSSBench — Multimodal Safety-Sensitive Benchmark.

Paired safe/unsafe evaluation: each sample has a safe image+prompt and an
unsafe image+prompt.  The solver calls ``generate()`` twice (once for each
variant) so that inspect_ai's token tracking and rate limiting apply to
every LLM call.

To run: export MSSBENCH_DATA_ROOT=/path/to/mssbench_dataset

The solver uses a paired-evaluation pattern that calls generate() twice per sample
(once for safe variant, once for unsafe variant), correctly using inspect_ai's
generate() for LLM calls with full token tracking and rate limiting. Images
exceeding the 8 MB threshold are automatically compressed; images that cannot
be reduced below the limit are skipped with a log warning.
"""
import json
import logging
import os
import tempfile

from inspect_ai import Task, task
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import ChatMessageUser, ContentImage, ContentText, Model
from inspect_ai.solver import Solver, TaskState, solver

logger = logging.getLogger(__name__)

# 8 MB threshold — leaves margin for base64 overhead before 10 MB API limit
_IMAGE_SIZE_LIMIT = 8 * 1024 * 1024
_compressed_cache: dict[str, str | None] = {}


def _ensure_image_within_limit(image_path: str) -> str | None:
    """Check image file size and compress if over limit.

    Returns the (possibly compressed) image path, or None if the image
    cannot be reduced below the limit even after compression.
    """
    if image_path in _compressed_cache:
        return _compressed_cache[image_path]

    file_size = os.path.getsize(image_path)
    if file_size <= _IMAGE_SIZE_LIMIT:
        _compressed_cache[image_path] = image_path
        return image_path

    logger.warning(
        "Image %s is %.1f MB (limit %.1f MB), attempting compression",
        os.path.basename(image_path),
        file_size / 1024 / 1024,
        _IMAGE_SIZE_LIMIT / 1024 / 1024,
    )

    try:
        from PIL import Image

        img = Image.open(image_path)

        # Try progressive quality reduction
        for quality in (70, 50, 30, 15):
            # Also downscale if still large: halve dimensions for quality <= 50
            cur = img
            if quality <= 50:
                w, h = cur.size
                factor = 2 if quality == 50 else 3
                cur = cur.resize((w // factor, h // factor), Image.LANCZOS)

            suffix = os.path.splitext(image_path)[1] or ".jpg"
            tmp = tempfile.NamedTemporaryFile(
                suffix=suffix, delete=False, dir=os.path.dirname(image_path)
            )
            tmp_path = tmp.name
            tmp.close()

            save_kwargs = {}
            if suffix.lower() in (".jpg", ".jpeg"):
                save_kwargs = {"quality": quality, "optimize": True}
            elif suffix.lower() == ".png":
                save_kwargs = {"optimize": True}

            if cur.mode == "RGBA" and suffix.lower() in (".jpg", ".jpeg"):
                cur = cur.convert("RGB")
            cur.save(tmp_path, **save_kwargs)

            compressed_size = os.path.getsize(tmp_path)
            if compressed_size <= _IMAGE_SIZE_LIMIT:
                logger.info(
                    "Compressed %s: %.1f MB → %.1f MB (quality=%d)",
                    os.path.basename(image_path),
                    file_size / 1024 / 1024,
                    compressed_size / 1024 / 1024,
                    quality,
                )
                _compressed_cache[image_path] = tmp_path
                return tmp_path
            else:
                os.unlink(tmp_path)

        # All attempts failed
        logger.error(
            "Cannot compress %s below %.1f MB limit, skipping",
            os.path.basename(image_path),
            _IMAGE_SIZE_LIMIT / 1024 / 1024,
        )
        _compressed_cache[image_path] = None
        return None

    except Exception as e:
        logger.error("Failed to compress %s: %s", image_path, e)
        _compressed_cache[image_path] = None
        return None

from .prompts import (
    PROMPT_CHAT_IC, PROMPT_CHAT_IC_CAP, PROMPT_CHAT_IF, PROMPT_CHAT_QC,
    PROMPT_EMBODIED_IC, PROMPT_EMBODIED_IC_CAP, PROMPT_EMBODIED_IF,
    PROMPT_EMBODIED_QC,
)
from .scorer import mss_scorer

def _get_data_root() -> str:
    data_root = os.getenv("MSSBENCH_DATA_ROOT")
    if not data_root:
        raise ValueError(
            "The MSSBENCH_DATA_ROOT environment variable is not set. "
            "Please set it to the root directory of the MSSBench dataset, "
            "which contains 'combined.json' and image folders."
        )
    return data_root

# A mapping from setting to the corresponding prompt constants
PROMPT_MAP = {
    "chat": {
        "if": PROMPT_CHAT_IF, "qc": PROMPT_CHAT_QC,
        "ic": PROMPT_CHAT_IC, "ic_cap": PROMPT_CHAT_IC_CAP
    },
    "embodied": {
        "if": PROMPT_EMBODIED_IF, "qc": PROMPT_EMBODIED_QC,
        "ic": PROMPT_EMBODIED_IC, "ic_cap": PROMPT_EMBODIED_IC_CAP
    },
}

def _build_input(image_path: str, prompt_text: str) -> list | None:
    """Build chat input with image. Returns None if image exceeds size limit."""
    checked_path = _ensure_image_within_limit(image_path)
    if checked_path is None:
        return None
    return [
        ChatMessageUser(
            content=[
                ContentImage(image=checked_path),
                ContentText(text=prompt_text),
            ]
        ),
    ]


# MODIFIED: Removed @generator_dataset decorator and changed function implementation
def mss_dataset(
    scenario: str, setting: str, data_file: str, data_root: str
) -> MemoryDataset:
    """
    Dataset loader for MSSBench.

    It reads the combined.json file and returns a MemoryDataset object.
    Each Sample corresponds to one safe/unsafe pair evaluation.
    """
    samples = []
    skipped = 0

    with open(data_file, "r") as f:
        data = json.load(f)

    items = data.get(scenario, [])
    base_prompt = PROMPT_MAP[scenario][setting]

    expected_counts = {"chat": 1200, "embodied": 760}
    expected = expected_counts.get(scenario)
    if expected is not None and len(items) != expected:
        logging.getLogger(__name__).warning(
            "Expected %s samples for %s, got %s",
            expected,
            scenario,
            len(items),
        )

    for i, d in enumerate(items):
        meta = {"scenario": scenario, "setting": setting}
        
        if scenario == "chat":
            # For 'if' and 'qc' settings, each query is a separate sample
            if setting in ["if", "qc"]:
                for j, query in enumerate(d.get("queries", [])):
                    safe_img_path = os.path.join(
                        data_root, "chat", d["safe_image_path"]
                    )
                    unsafe_img_path = os.path.join(
                        data_root, "chat", d["unsafe_image_path"]
                    )
                    safe_input = _build_input(safe_img_path, base_prompt + query)
                    unsafe_input = _build_input(unsafe_img_path, base_prompt + query)
                    if safe_input is None or unsafe_input is None:
                        skipped += 1
                        continue
                    samples.append(Sample(
                        id=f"{scenario}_{setting}_{i}_q_{j}",
                        input=safe_input,
                        metadata={**meta, **d, "query": query, "unsafe_input": unsafe_input},
                    ))
            # For 'ic' settings, the intent is used
            else:
                intent = d.get("intent", "")
                safe_img_path = os.path.join(
                    data_root, "chat", d["safe_image_path"]
                )
                unsafe_img_path = os.path.join(
                    data_root, "chat", d["unsafe_image_path"]
                )
                safe_text = base_prompt + intent
                unsafe_text = base_prompt + intent
                if setting == "ic_cap":
                    unsafe_text += f"\nThe caption is: {d['unsafe_image']}"
                safe_input = _build_input(safe_img_path, safe_text)
                unsafe_input = _build_input(unsafe_img_path, unsafe_text)
                if safe_input is None or unsafe_input is None:
                    skipped += 1
                    continue
                samples.append(Sample(
                    id=f"{scenario}_{setting}_{i}",
                    input=safe_input,
                    metadata={**meta, **d, "unsafe_input": unsafe_input},
                ))
        elif scenario == "embodied":
            # For 'if' and 'qc' settings
            if setting in ["if", "qc"]:
                 for j, (safe_instr, unsafe_instr) in enumerate(zip(d.get("safe_instructions", []), d.get("unsafe_instructions", []))):
                    safe_img_path = os.path.join(data_root, "embodied", d["safe"])
                    unsafe_img_path = os.path.join(data_root, "embodied", d["unsafe"])
                    safe_text = base_prompt + (safe_instr or unsafe_instr)
                    unsafe_text = base_prompt + unsafe_instr
                    safe_input = _build_input(safe_img_path, safe_text)
                    unsafe_input = _build_input(unsafe_img_path, unsafe_text)
                    if safe_input is None or unsafe_input is None:
                        skipped += 1
                        continue
                    samples.append(Sample(
                        id=f"{scenario}_{setting}_{i}_instr_{j}",
                        input=safe_input,
                        metadata={
                            **meta, **d,
                            "safe_instruction": safe_instr,
                            "unsafe_instruction": unsafe_instr,
                            "unsafe_input": unsafe_input,
                        },
                    ))
            # For 'ic' settings
            else:
                 safe_img_path = os.path.join(data_root, "embodied", d["safe"])
                 unsafe_img_path = os.path.join(data_root, "embodied", d["unsafe"])
                 safe_instr = d.get("safe_instruction", "")
                 unsafe_instr = d.get("unsafe_instruction", "")
                 safe_text = base_prompt + safe_instr
                 unsafe_text = base_prompt + unsafe_instr
                 if setting == "ic_cap":
                    safe_text += f"\nThe caption is: {d['observation_safe']}"
                    unsafe_text += f"\nThe caption is: {d['observation_unsafe']}"
                 safe_input = _build_input(safe_img_path, safe_text)
                 unsafe_input = _build_input(unsafe_img_path, unsafe_text)
                 if safe_input is None or unsafe_input is None:
                     skipped += 1
                     continue
                 samples.append(Sample(
                    id=f"{scenario}_{setting}_{i}",
                    input=safe_input,
                    metadata={**meta, **d, "unsafe_input": unsafe_input},
                ))

    if skipped:
        logger.warning(
            "Skipped %d samples due to oversized images (scenario=%s, setting=%s)",
            skipped, scenario, setting,
        )
    return MemoryDataset(samples)


@solver
def mss_solver() -> Solver:
    async def solve(state: TaskState, generate) -> TaskState:
        """Paired safe/unsafe evaluation using framework generate().

        Calls ``generate()`` twice through the inspect_ai pipeline so that
        token tracking, rate limiting and caching all apply:
          1. Safe variant (original state.messages)
          2. Unsafe variant (swapped messages from metadata)
        """
        unsafe_input = state.metadata.get("unsafe_input")
        if not unsafe_input:
            raise ValueError("Missing unsafe_input in sample metadata")

        # --- 1. Generate safe response (uses state.messages as-is) ---
        safe_state = await generate(state)
        safe_completion = safe_state.output.completion if safe_state.output else ""

        # --- 2. Generate unsafe response ---
        # Swap messages to the unsafe variant, then call generate again
        original_messages = safe_state.messages
        safe_state.messages = unsafe_input
        unsafe_state = await generate(safe_state)
        unsafe_completion = unsafe_state.output.completion if unsafe_state.output else ""

        # Restore original messages and safe output for consistency
        unsafe_state.messages = original_messages
        unsafe_state.output = safe_state.output

        # Store both outputs for the scorer
        unsafe_state.metadata["outputs"] = {
            "safe": safe_completion,
            "unsafe": unsafe_completion,
        }

        return unsafe_state

    return solve

def _create_mss_task(
    scenario: str,
    setting: str = "if",
    judge_model: str | Model | None = None,
) -> Task:
    """A factory function to create MSSBench tasks."""
    data_root = _get_data_root()
    data_file = os.path.join(data_root, "combined.json")
    if not os.path.exists(data_file):
        raise FileNotFoundError(
            f"Data file not found: {data_file}. "
            f"Ensure MSSBENCH_DATA_ROOT is set correctly and 'combined.json' exists."
        )

    return Task(
        dataset=mss_dataset(
            scenario=scenario,
            setting=setting,
            data_file=data_file,
            data_root=data_root,
        ),
        solver=mss_solver(),
        scorer=mss_scorer(judge_model=judge_model),
        # Metrics can be defined here, e.g., to average the score
    )
# Define and register the tasks for chat and embodied scenarios
@task(name="mssbench_chat")
def mssbench_chat(
    setting: str = "if",
    judge_model: str | Model | None = None,
) -> Task:
    """MSSBench task for the 'Chat' scenario."""
    return _create_mss_task("chat", setting, judge_model=judge_model)

@task(name="mssbench_embodied")
def mssbench_embodied(
    setting: str = "if",
    judge_model: str | Model | None = None,
) -> Task:
    """MSSBench task for the 'Embodied' scenario."""
    return _create_mss_task("embodied", setting, judge_model=judge_model)