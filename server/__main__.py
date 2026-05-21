import argparse
import os


def main():
    parser = argparse.ArgumentParser(description="SatoriLite RAG server")
    parser.add_argument("--vault", default=os.environ.get("SATORILITE_VAULT", "."),
                        help="Path to the vault directory")
    parser.add_argument("--port", type=int, default=int(os.environ.get("SATORILITE_PORT", "8787")),
                        help="Port to listen on (default: 8787)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Host to bind to (default: 127.0.0.1)")
    args = parser.parse_args()

    os.environ["SATORILITE_VAULT"] = os.path.abspath(args.vault)
    os.environ["SATORILITE_PORT"] = str(args.port)

    import uvicorn
    uvicorn.run("server.main:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
