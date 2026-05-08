"""All eight list-source fetchers, registered in ALL_FETCHERS for the orchestrator."""
from .fatf import FatfFetcher
from .ofac_countries import OfacCountriesFetcher
from .un_consolidated import UnConsolidatedFetcher
from .eu_consolidated import EuConsolidatedFetcher
from .basel_aml import BaselAmlFetcher
from .ti_cpi import TiCpiFetcher
from .wjp_rol import WjpRolFetcher
from .tjn_fsi import TjnFsiFetcher

ALL_FETCHERS = [
    FatfFetcher(),
    OfacCountriesFetcher(),
    UnConsolidatedFetcher(),
    EuConsolidatedFetcher(),
    BaselAmlFetcher(),
    TiCpiFetcher(),
    WjpRolFetcher(),
    TjnFsiFetcher(),
]
