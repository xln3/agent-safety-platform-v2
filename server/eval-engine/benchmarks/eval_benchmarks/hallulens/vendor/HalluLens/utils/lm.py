# Copyright (c) Meta Platforms, Inc. and affiliates.

# All rights reserved.

# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import os
import openai

'''
NOTE: 
    Available functions:
        - call_vllm_api: using vllm self-served models
        - openai_generate: using openai models
'''
########################################################################################################
def custom_api(prompt, model, temperature=0.0, top_p=1.0, max_tokens=512):
    raise NotImplementedError()


# =========================
# A) 新增：OpenAI 兼容 API 调用（走环境变量）
# =========================
import threading

_openai_compat_client = None
_openai_compat_lock = threading.Lock()


def _get_openai_compat_client():
    """
    Create (and cache) a thread-safe singleton OpenAI client.
    The OpenAI/httpx client is thread-safe and manages its own connection pool,
    so sharing one client across threads avoids resource exhaustion and deadlocks.
    """
    global _openai_compat_client
    if _openai_compat_client is not None:
        return _openai_compat_client
    with _openai_compat_lock:
        if _openai_compat_client is not None:
            return _openai_compat_client
        base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
        if not base_url or not api_key:
            raise RuntimeError("Missing env vars: OPENAI_BASE_URL and/or OPENAI_API_KEY")
        timeout_s = float(os.getenv("OPENAI_TIMEOUT", "120"))
        _openai_compat_client = openai.OpenAI(
            base_url=base_url, api_key=api_key, timeout=timeout_s,
        )
    return _openai_compat_client


def get_max_workers(default: int = 8) -> int:
    """Return capped max_workers for thread_map calls (inference & eval)."""
    cap = int(os.getenv("HALLULENS_MAX_WORKERS", str(default)))
    return max(1, min(int(default), cap))


def call_openai_compat(prompt, model, temperature, top_p, max_tokens):
    import time, random

    api_model = os.getenv("OPENAI_MODEL") or model
    max_retries = int(os.getenv("OPENAI_MAX_RETRIES", "6"))

    client = _get_openai_compat_client()

    last_err = None
    for attempt in range(max_retries):
        try:
            chat_completion = client.chat.completions.create(
                model=api_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
            )
            return chat_completion.choices[0].message.content
        except Exception as e:
            last_err = e
            sleep_s = min(60, (2 ** attempt)) + random.random()
            print(
                f"[call_openai_compat] api_model={api_model} error={type(e).__name__}: {e} "
                f"| retry in {sleep_s:.1f}s ({attempt+1}/{max_retries})"
            )
            time.sleep(sleep_s)

    raise last_err

def generate(prompt, model, temperature=0.0, top_p=1.0, max_tokens=512, port=None, i=0):

    # TODO: You need to use your own inference method
    # return custom_api(prompt, model, temperature, top_p, max_tokens, port)
    return call_openai_compat(prompt, model, temperature, top_p, max_tokens)

CUSTOM_SERVER = "0.0.0.0" # you may need to change the port

model_map = {   'meta-llama/Llama-3.1-405B-Instruct-FP8': {'name': 'llama3.1_405B',
                                                            'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"]},
                'meta-llama/Llama-3.3-70B-Instruct': {'name': 'llama3.3_70B',
                                                    'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"]},
                'meta-llama/Llama-3.1-70B-Instruct': {'name': 'llama3.1_70B',
                                                        'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"],
                                                    },
                'meta-llama/Llama-3.1-8B-Instruct': {'name': 'llama3.1_8B',
                                                        'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"],
                                                    },
                'mistralai/Mistral-7B-Instruct-v0.2': {'name': 'mistral7B',
                                                        'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"],
                                                    },
                "mistralai/Mistral-Nemo-Instruct-2407": {'name': 'Mistral-Nemo-Instruct-2407',
                                                        'server_urls': [f"http://{CUSTOM_SERVER}:8000/v1"],
                                                    },
                                                    
            }
########################################################################################################

def call_vllm_api(prompt, model, temperature=0.0, top_p=1.0, max_tokens=512, port=None, i=0):
    # =========================
    # B) 兜底：如果 model 不在 model_map，就自动走 OpenAI 兼容 API
    # =========================
    if model not in model_map:
        return call_openai_compat(prompt, model, temperature=temperature, top_p=top_p, max_tokens=max_tokens)

    if port == None:
        port = model_map[model]["server_urls"][i]

    client = openai.OpenAI(
        base_url=f"{port}",
        api_key="NOT A REAL KEY",
    )
    chat_completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user","content": prompt}],
        max_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p
    )

    return chat_completion.choices[0].message.content

def openai_generate(prompt, model, temperature=0.0, top_p=1.0, max_tokens=512):
    # Create a client object
    client = openai.OpenAI(
        api_key=os.environ["OPENAI_KEY"],
    )
    chat_completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p
    )

    return chat_completion.choices[0].message.content