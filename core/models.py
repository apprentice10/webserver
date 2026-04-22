from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    client = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relazione con le impostazioni
    settings = relationship("ProjectSettings", back_populates="project", cascade="all, delete-orphan")


class ProjectSettings(Base):
    __tablename__ = "project_settings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    key = Column(String(100), nullable=False)
    value = Column(Text, nullable=True)

    # Relazione inversa verso Project
    project = relationship("Project", back_populates="settings")