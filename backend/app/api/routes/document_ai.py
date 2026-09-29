from pathlib import Path
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.model.document import Document
from app.model.project import Project
from app.innovations.document_ai.service import (
    analyse_document,
    extract_text_from_file,
)

router = APIRouter(
    prefix="/api/v1/documents",
    tags=["Document Intelligence"],
)


UPLOAD_ROOT = Path("uploads/documents")

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
}


@router.post("/analyze")
async def analyze_document(
    project_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if project is None:
        raise HTTPException(
            status_code=404,
            detail="Project not found.",
        )

    original_name = file.filename or "document"

    extension = Path(original_name).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
    "Supported document formats are "
    "PDF, TXT, JPG, JPEG and PNG."
),
        )

    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty.",
        )

    project_directory = (
        UPLOAD_ROOT
        / f"project_{project_id}"
    )

    project_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    stored_name = (
        f"{uuid4().hex}{extension}"
    )

    stored_path = (
        project_directory
        / stored_name
    )

    stored_path.write_bytes(file_bytes)

    try:
        (
    extracted_text,
    extraction_method,
) = extract_text_from_file(
    file_bytes=file_bytes,
    extension=extension,
)

        analysis = analyse_document(
    text=extracted_text,
    file_name=original_name,
    extraction_method=extraction_method,
)

        processing_status = (
            analysis["processing_status"]
        )

        document = Document(
            project_id=project_id,
            document_type=analysis[
                "document_type"
            ],
            file_name=original_name,
            file_path=str(stored_path),
            extracted_text=extracted_text,
            extracted_data=analysis[
                "extracted_data"
            ],
            risk_signals=analysis[
                "risk_signals"
            ],
            processing_status=processing_status,
        )

        db.add(document)
        db.commit()
        db.refresh(document)

        return {
            "success": True,
            "document": {
                "id": document.id,
                "project_id": document.project_id,
                "file_name": document.file_name,
                "document_type": (
                    document.document_type
                ),
                "processing_status": (
                    document.processing_status
                ),
                "extracted_data": (
                    document.extracted_data
                ),
                "risk_signals": (
                    document.risk_signals
                ),
                "uploaded_at": (
                    document.uploaded_at
                    .isoformat()
                    if document.uploaded_at
                    else None
                ),
            },
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Document processing failed: {exc}",
        ) from exc


@router.get("/projects/{project_id}")
def get_project_documents(
    project_id: int,
    db: Session = Depends(get_db),
):
    documents = (
        db.query(Document)
        .filter(
            Document.project_id == project_id
        )
        .order_by(
            Document.uploaded_at.desc()
        )
        .all()
    )

    return {
        "success": True,
        "project_id": project_id,
        "total_documents": len(documents),
        "documents": [
            {
                "id": document.id,
                "file_name": document.file_name,
                "document_type": (
                    document.document_type
                ),
                "processing_status": (
                    document.processing_status
                ),
                "extracted_data": (
                    document.extracted_data
                ),
                "risk_signals": (
                    document.risk_signals
                ),
                "uploaded_at": (
                    document.uploaded_at
                    .isoformat()
                    if document.uploaded_at
                    else None
                ),
            }
            for document in documents
        ],
    }


@router.get("/{document_id}")
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
):
    document = (
        db.query(Document)
        .filter(Document.id == document_id)
        .first()
    )

    if document is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    return {
        "success": True,
        "document": {
            "id": document.id,
            "project_id": document.project_id,
            "file_name": document.file_name,
            "document_type": document.document_type,
            "processing_status": (
                document.processing_status
            ),
            "extracted_text": (
                document.extracted_text
            ),
            "extracted_data": (
                document.extracted_data
            ),
            "risk_signals": (
                document.risk_signals
            ),
            "uploaded_at": (
                document.uploaded_at.isoformat()
                if document.uploaded_at
                else None
            ),
        },
    }