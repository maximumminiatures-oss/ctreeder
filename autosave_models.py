"""One account-owned automatic dungeon snapshot, separate from manual saves."""
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, Integer, ForeignKey, JSON, DateTime

class AccountAutosave(SQLModel, table=True):
    __tablename__ = "account_autosaves"
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True))
    state_json: dict = Field(sa_column=Column(JSON, nullable=False))
    room_json: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    revision: int = Field(default=1, nullable=False)
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)))
