"""Jev (TypeSafe) client — fast, typed yes/no + classification decisions on the
Emergent universal key. Used to (1) filter off-topic chatter and (2) gate
destructive commands before the droid touches the phone."""
import os
from functools import lru_cache

from dotenv import load_dotenv
from typesafe_sdk import AsyncTypeSafeClient, RetryPolicy

load_dotenv()


@lru_cache(maxsize=1)
def get_jev_client() -> AsyncTypeSafeClient:
    proxy = (
        os.getenv("INTEGRATION_PROXY_URL")
        or os.getenv("integration_proxy_url")
        or "https://integrations.emergentagent.com"
    ).rstrip("/")
    return AsyncTypeSafeClient(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        base_url=f"{proxy}/llm/typesafe",
        retry=RetryPolicy(max_retries=2, respect_retry_after=False),
    )
