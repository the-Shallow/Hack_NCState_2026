from fastapi import FastAPI
from dotenv import load_dotenv
import os
from app.api.routes import router as api_router

from fastapi.middleware.cors import CORSMiddleware

base_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(base_dir, '.env')
load_dotenv(env_path)
# load_dotenv() # Debug: Check if the API key is loaded

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



print(os.getenv("BACKBOARD_API_KEY")) 
app.include_router(api_router, prefix="/api")