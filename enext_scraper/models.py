from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ProductData:
    """Normalized product data extracted from an enext.ua product page."""

    url: str
    name: str = ""
    catalog_code: str = ""
    manufacturer: str = ""
    technical_parameters: dict[str, str] = field(default_factory=dict)
    manufacturer_description: str = ""

    def has_required_content(self) -> bool:
        return bool(self.name and (self.catalog_code or self.technical_parameters))

