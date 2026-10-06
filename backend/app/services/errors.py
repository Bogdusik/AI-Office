class DomainError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFoundError(DomainError):
    pass


class ConflictError(DomainError):
    pass


class ValidationFailedError(DomainError):
    pass
