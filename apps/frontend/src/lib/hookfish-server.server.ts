import { Hookfish } from '@hookfish/api'

import config from '../../../../hookfish.config'

export const hookfishServer = await Hookfish.init(config)
