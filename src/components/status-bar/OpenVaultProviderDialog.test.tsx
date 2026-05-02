import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpenVaultProviderDialog } from './OpenVaultProviderDialog'
import '@testing-library/jest-dom'

describe('OpenVaultProviderDialog', () => {
  it('renders invalid selection state', () => {
    const onCancel = vi.fn()
    render(
      <OpenVaultProviderDialog
        open={true}
        validationResult="invalid"
        validationMessage="Not inside iCloud"
        inferredProvider="icloud-drive"
        onSelect={vi.fn()}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText('Invalid Selection')).toBeInTheDocument()
    expect(screen.getByText('Not inside iCloud')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders warning selection state', () => {
    const onSelect = vi.fn()
    render(
      <OpenVaultProviderDialog
        open={true}
        validationResult="warning"
        validationMessage="Inside iCloud but local selected"
        inferredProvider="local-folder"
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Provider Mismatch')).toBeInTheDocument()
    expect(screen.getByText('Inside iCloud but local selected')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('Use Local Folder'))
    expect(onSelect).toHaveBeenCalledWith('local-folder')
  })

  it('renders provider selection state', () => {
    const onSelect = vi.fn()
    render(
      <OpenVaultProviderDialog
        open={true}
        validationResult="valid"
        validationMessage={null}
        inferredProvider="icloud-drive"
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Choose Vault Storage')).toBeInTheDocument()
    
    fireEvent.click(screen.getByTestId('select-provider-local'))
    expect(onSelect).toHaveBeenCalledWith('local-folder')

    fireEvent.click(screen.getByTestId('select-provider-icloud'))
    expect(onSelect).toHaveBeenCalledWith('icloud-drive')
  })
})
