from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="${{ values.componentId }}",
    description="${{ values.description }}",
    version="0.1.0",
)


class Greeting(BaseModel):
    message: str
    service: str


class HealthStatus(BaseModel):
    status: str


@app.get("/", response_model=Greeting)
def read_root() -> Greeting:
    return Greeting(
        message="Hello from ${{ values.componentId }}",
        service="${{ values.componentId }}",
    )


@app.get("/health", response_model=HealthStatus)
def health() -> HealthStatus:
    """Liveness/readiness probe used by the container platform."""
    return HealthStatus(status="ok")
