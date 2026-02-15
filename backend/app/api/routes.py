import os
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from app.schemas.agent_io import AgentContext, AgentOutput, ClaimInput
from app.agents.backboard_agent import BackboardAgent

router = APIRouter()

base_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.dirname(base_dir)   # go from /app/api → /app
env_path = os.path.join(app_dir, '.env')
load_dotenv(env_path)

BACKBOARD_API_KEY = os.getenv("BACKBOARD_API_KEY")
print(f"Loaded BACKBOARD_API_KEY: {BACKBOARD_API_KEY is not None}")  # Debug statement
agent_runner = BackboardAgent(api_key=BACKBOARD_API_KEY)

@router.post("/analyze_claims", response_model=AgentOutput)
async def analyze_claims(payload: ClaimInput):
    try:
        result = await agent_runner.run(payload)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))