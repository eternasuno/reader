# Reference scenarios for the Setting domain. Spec: docs/usecases/setting.md
# Scenarios tagged @ui describe front-end behavior; @boundary describe HTTP-edge parsing.
Feature: Settings
  As a user with my own account
  I want to choose how many articles a feed keeps and how pages are fetched
  So that the reader fits my environment

  Background:
    Given I am signed in
    And I open the settings page

  # SET-GET-1, SET-VAL-1, SET-VAL-3
  Scenario: Defaults for a new user
    Then the retention is 100
    And the provider is "jina"
    And no Jina key is configured
    And no browser service address is configured

  # SET-VAL-4, SET-GET-2
  @boundary
  Scenario: Secrets are never shown
    Given I saved a Jina key and a browser service address
    When the settings are read through the API
    Then the response says whether a key is configured and whether an address is configured
    But it contains neither the key nor the address

  # SET-VAL-4, SET-GET-2
  @ui
  Scenario: The settings page shows only whether each secret is configured
    Given I saved a Jina key and a browser service address
    Then the settings page shows only that each one is configured

  # SET-FEED-1, SET-FEED-2
  Scenario: Change retention
    When I set the retention to 50
    Then the retention is 50
    And existing feeds are not trimmed now

  # SET-FEED-2, FD-SEL-3
  @system
  Scenario: A feed is trimmed at its next refresh
    Given the retention is set to 50
    And a feed holds more than 50 articles
    When the feed's next refresh succeeds
    Then the feed holds at most 50 articles

  # SET-VAL-1, SET-VAL-5
  @boundary
  Scenario Outline: Retention must be a positive integer
    When I set the retention to <value>
    Then <outcome>

    Examples:
      | value | outcome                 |
      | 1     | it is saved             |
      | 1000  | it is saved             |
      | 0     | the request is rejected |
      | 50.5  | the request is rejected |

  # SET-FETCH-1
  Scenario: Use Jina with a key
    When I choose "Jina", enter a key and save
    Then the provider is "jina"
    And the key is stored
    And a stored browser address is untouched

  # SET-FETCH-1
  @boundary
  Scenario: First use of Jina without a key
    Given no Jina key is configured
    When I submit the Jina key as empty with provider "jina"
    Then the provider is "jina"
    And no Jina key is configured
    And a stored browser address is untouched

  # SET-FETCH-1
  Scenario: Replacing an existing Jina key
    Given a Jina key is configured
    And a browser address is configured
    When I choose "Jina", enter a new key and save
    Then the new key is stored
    And the provider is "jina"
    And the browser address is untouched

  # SET-FETCH-1, SET-VAL-6
  @boundary
  Scenario: Save Jina again without typing the key
    Given a Jina key is configured
    When I submit the Jina key as empty with provider "jina"
    Then the provider is "jina"
    And the stored key is kept

  # SET-FETCH-2, SET-FETCH-3
  Scenario: First use of the browser needs an address
    Given no browser service address is configured
    When I choose "Browser", leave the address empty and save
    Then saving fails because the address is required
    And the provider is not changed

  # SET-FETCH-2
  Scenario: First use of the browser with an address
    When I choose "Browser", enter an address and save
    Then the provider is "browser"
    And the address is stored
    And a stored Jina key is untouched

  # SET-FETCH-2, SET-VAL-6
  @boundary
  Scenario: Switch back to the browser without retyping the address
    Given a browser service address is configured and the provider is "jina"
    When I submit the browser address as empty with provider "browser"
    Then the provider is "browser"
    And the stored address is kept

  # SET-FETCH-2
  Scenario: Replace the browser address
    Given the provider is "browser"
    When I enter a new address and save
    Then the stored address is replaced

  # SET-FETCH-3, SET-FETCH-4
  Scenario: Choosing the browser without an address fails and changes nothing
    Given the provider is "jina"
    And no browser address is stored
    When I choose "Browser" with no address and save
    Then saving fails because the address is required
    And the stored settings are unchanged

  # SET-FETCH-5
  Scenario: Switching providers keeps the other one's configuration
    Given I configured both a Jina key and a browser address
    When I switch the provider
    Then both configurations are still stored

  # SET-KEY-1; the confirmation is front-end behavior
  @ui
  Scenario: Clear the Jina key
    Given a Jina key is configured
    When I choose to clear the key
    Then I am asked to confirm
    When I confirm
    Then no key is configured
    And the provider is unchanged

  # SET-KEY-2
  Scenario: Clear a key that is not there
    Given no Jina key is configured
    When the key is cleared
    Then nothing changes and there is no error

  # SET-KEY-1
  @ui
  Scenario: Cancel clearing the key
    Given a Jina key is configured
    When I choose to clear the key and then cancel
    Then the key is kept

  # SET-ENDPOINT-1, SET-ENDPOINT-2
  @ui
  Scenario: The settings offer no way to remove the address
    Given a browser service address is configured
    Then the settings offer no way to remove it
    But I can replace it

  # SET-VAL-6, SET-FETCH-1, SET-FETCH-2
  @boundary
  Scenario Outline: An omitted, empty or blank field keeps the stored value
    Given a Jina key and a browser address are configured
    And the provider is "jina"
    When I submit <field> as <input> with provider "<provider>"
    Then the provider is "<provider>"
    And the stored <field> is unchanged

    Examples:
      | field               | input   | provider |
      | the Jina key        | omitted | jina     |
      | the Jina key        | empty   | jina     |
      | the Jina key        | blank   | jina     |
      | the browser address | omitted | browser  |
      | the browser address | empty   | browser  |
      | the browser address | blank   | browser  |

  # SET-VAL-6, SET-FETCH-3, SET-FETCH-4
  @boundary
  Scenario Outline: An omitted, empty or blank address with none stored fails
    Given no browser address is stored
    When I choose "Browser" and submit the address as <input> and save
    Then saving fails with BrowserEndpointRequired
    And nothing changes

    Examples:
      | input   |
      | omitted |
      | empty   |
      | blank   |

  # SET-VAL-2, SET-VAL-3
  @boundary
  Scenario Outline: Value formats are checked at the edge
    When I submit <input>
    Then <outcome>

    Examples:
      | input                                | outcome                 |
      | the browser address "ws://host:9222" | it is accepted          |
      | the browser address "ftp://host"     | the request is rejected |
      | the browser address "not a url"      | the request is rejected |

  # SET-OWN-1
  Scenario: Settings are per user
    Given another user changed their settings
    Then my settings are unchanged

  # front-end behavior: choosing a provider only changes the form
  @ui
  Scenario: Choosing a provider only changes the form
    When I pick another provider
    Then the form shows that provider's field
    But nothing is saved until I press save
