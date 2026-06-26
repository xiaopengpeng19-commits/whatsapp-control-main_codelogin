from fastapi import FastAPI, Request
import uvicorn

app = FastAPI()

@app.post("/api/accountcallback")
async def account_callback(request: Request):
    """
    Handles the account callback request.
    """
    id=request.query_params.get("id")
    print(id)
    return {"message": "Account callback received"}
@app.get("/api/accountcallback")
async def account_callback_get(request: Request):
    """
    Handles the account callback request.
    """
    id=request.query_params.get("id")
    print(id)
    return {"message": "Account callback received get"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9999)
