# Reference scenarios for the Setting domain. Spec: docs/usecases/setting.md
# Scenarios tagged @ui describe front-end behavior; @boundary describe HTTP-edge parsing.
Feature: Settings
  As a signed-in user
  I want to choose how many articles a feed keeps and how pages are fetched
  So that the reader fits my environment

  Background:
    Given I am signed in
    And I open the settings page

  # SET-GET-1
  Scenario: Defaults for a new user
    Then the retention is 100
    And the provider is "jina"
    And no Jina key is configured
    And no browser service address is configured

  # Decided at the boundary: the API reports only whether each value is configured
  @boundary
  Scenario: Secrets are never shown
    Given I saved a Jina key and a browser service address
    When I open the settings page
    Then I see that each one is configured
    But I cannot read the key or the address

  # SET-FEED-1, SET-FEED-2
  Scenario: Change retention
    When I set the retention to 50
    Then the retention is 50
    And existing feeds are not trimmed now
    And each feed is trimmed to 50 articles at its next refresh

  # SET-FEED, boundary
  @boundary
  Scenario Outline: Retention must be an integer between 30 and 300
    When I set the retention to <value>
    Then <outcome>

    Examples:
      | value | outcome                  |
      | 30    | it is saved              |
      | 300   | it is saved              |
      | 29    | the request is rejected  |
      | 301   | the request is rejected  |
      | 50.5  | the request is rejected  |

  # SET-FETCH-1
  Scenario: Use Jina with a key
    When I choose "Jina", enter a key and save
    Then the provider is "jina"
    And the key is stored
    And a stored browser address is untouched

  # SET-FETCH-1
  Scenario: Save Jina again without typing the key
    Given a Jina key is configured
    When I choose "Jina", leave the key empty and save
    Then the stored key is kept

  # SET-FETCH-2, SET-FETCH-3
  Scenario: First use of the browser needs an address
    Given no browser service address is configured
    When I choose "Browser", leave the address empty and save
    Then saving fails because the address is required
    And the provider is not changed

  Scenario: First use of the browser with an address
    When I choose "Browser", enter an address and save
    Then the provider is "browser"
    And the address is stored
    And a stored Jina key is untouched

  # SET-FETCH-2
  Scenario: Switch back to the browser without retyping the address
    Given a browser service address is configured and the provider is "jina"
    When I choose "Browser", leave the address empty and save
    Then the provider is "browser"
    And the stored address is kept

  # SET-FETCH-2
  Scenario: Replace the browser address
    Given the provider is "browser"
    When I enter a new address and save
    Then the stored address is replaced

  # SET-FETCH-5
  Scenario: Switching providers keeps the other one's configuration
    Given I configured both a Jina key and a browser address
    When I switch the provider
    Then both configurations are still stored

  # SET-FETCH-4
  Scenario: The browser provider always has an address
    Then the provider is never "browser" while no address is stored

  # SET-KEY-1; the confirmation is front-end behavior
  @ui
  Scenario: Clear the Jina key
    Given a Jina key is configured
    When I choose to clear the key
    Then I am asked to confirm
    When I confirm
    Then no key is configured
    And the provider is unchanged

  @ui
  Scenario: Cancel clearing the key
    Given a Jina key is configured
    When I choose to clear the key and then cancel
    Then the key is kept

  # SET-ENDPOINT-1
  Scenario: The browser address cannot be cleared
    Then there is no way to remove a stored browser address
    But I can replace it

  # Value types of the Setting entity, decoded at the edge
  @boundary
  Scenario Outline: Value formats are checked at the edge
    When I submit <input>
    Then <outcome>

    Examples:
      | input                                | outcome                 |
      | a key with a line break              | the request is rejected |
      | a key longer than 2048 characters    | the request is rejected |
      | the browser address "ws://host:9222" | it is accepted          |
      | the browser address "ftp://host"     | the request is rejected |
      | the browser address "not a url"      | the request is rejected |

  @boundary
  Scenario: A blank key or address counts as not given
    When I save with a field that holds only spaces
    Then it is handled as if the field was left empty

  # SET-OWN-1
  Scenario: Settings are per user
    Given another user changed their settings
    Then my settings are unchanged

  # UI flow
  @ui
  Scenario: Choosing a provider only changes the form
    When I pick another provider
    Then the form shows that provider's field
    But nothing is saved until I press save
