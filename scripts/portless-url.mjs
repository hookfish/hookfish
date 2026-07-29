#!/usr/bin/env node
import { getPortlessRoute } from './portless-utils.mjs'

const [, , appName] = process.argv

if (appName) {
  console.log(getPortlessRoute(appName).url)
} else {
  for (const app of ['frontend', 'server']) {
    console.log(`${app}: ${getPortlessRoute(app).url}`)
  }
}
