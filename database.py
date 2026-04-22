from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./instrument_manager.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # Necessario solo per SQLite
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    Dependency FastAPI: apre una sessione DB per ogni richiesta
    e la chiude automaticamente al termine, anche in caso di errore.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()