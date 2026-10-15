class AppError(Exception):
    """Error bisnis yang aman ditampilkan ke user (tanpa detail internal)."""

    def __init__(self, status: int, code: str, message: str, details: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
